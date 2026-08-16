import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, type Database } from "@/server/db/client";
import { aiMessages, auditEvents, buildingBlockVersions, buildingBlocks, generationJobMedia, generationJobs, mediaAssets } from "@/server/db/schema";
import { resolveActorProvider } from "@/domain/ai/connections/model-resolution";
import { attachJobDuration, pricingFrom, recordAIUsage, workspaceOfProject } from "@/domain/ai/analytics/usage-service";
import { generateWithRepair, type ProviderCallRecorder } from "@/domain/ai/generation-runner";
import type { ActorProviderResolver } from "@/domain/page-generation/orchestration";
import { ProjectAccessService } from "@/server/permissions/project-access";
import { MediaService } from "@/domain/media/service";
import { EditingLeaseService } from "@/domain/collaboration/lease-service";
import { DomainError } from "@/domain/shared/errors";
import { AIError } from "@/domain/ai/provider";
import { ProjectContextBuilder } from "@/domain/ai/context";
import { GenerationJobLifecycle, safeAIError } from "@/domain/ai/job-service";
import { validateGeneratedBlockSource, type GeneratedBlockManifest } from "@/domain/blocks/validation";
import { recordChangeSet } from "@/domain/history/change-set-service";
import { elementInvalid, elementStale, findEditableElement, readResolvedSelection } from "@/domain/generated-source/selection";
import { generatedBlockResponseSchema, type BlockChangeSummary } from "./contract";
import { assembleBlockGenerationRequest, blockPromptVersion } from "./prompt";
import { observe } from "@/server/observability/events";
import { persistedGenerationDiagnostic } from "@/domain/generated-source/diagnostics";
import { repairGeneratedCanvasIds } from "@/domain/generated-source/canvas-id-repair";

function summaryMessage(summary: BlockChangeSummary) {
  return [summary.headline, ...summary.changes.map((item) => `• ${item}`), ...summary.limitations.map((item) => `Limitation: ${item}`)].join("\n");
}
function failureStage(error: AIError, fallback: string) {
  if (error.code === "AI_RESPONSE_SCHEMA_INVALID") return "response_schema";
  if (error.code === "AI_RESPONSE_MALFORMED") return "response_parse";
  if (error.code === "AI_RESPONSE_EMPTY" || error.code === "AI_RESPONSE_TRUNCATED") return "provider_response";
  if (error.code === "AI_GENERATED_SOURCE_INVALID") return "source_validation";
  return fallback;
}

/**
 * Building Block generation and modification. Shares the project context builder,
 * generation jobs, editing leases, provider abstraction, validation, and compilation
 * used by page generation; only the target entity and prompt contract differ.
 */
export class BlockGenerationOrchestrationService {
  constructor(
    private readonly database: Database = db,
    private readonly contextBuilder = new ProjectContextBuilder(),
    private readonly lifecycle = new GenerationJobLifecycle(database),
    private readonly providerResolver: ActorProviderResolver = (actorUserId) => resolveActorProvider(actorUserId, database),
    private readonly leases = new EditingLeaseService(),
    private readonly access = new ProjectAccessService(),
  ) {}

  private async current(jobId: string) { const [job] = await this.database.select().from(generationJobs).where(eq(generationJobs.id, jobId)).limit(1); return job; }

  private async cancellation(jobId: string) {
    const job = await this.current(jobId);
    if (!job) return true;
    if (!job.cancelRequestedAt && job.status !== "cancelled") return false;
    if (!(["completed", "failed", "cancelled"] as string[]).includes(job.status)) await this.lifecycle.transition(jobId, "cancelled", "Cancelled", { errorCode: "AI_JOB_CANCELLED", errorMessage: "The AI request was cancelled." });
    return true;
  }

  async process(jobId: string) {
    const startedAt = performance.now();
    const initial = await this.current(jobId);
    if (!initial || !["block_generate", "block_modify"].includes(initial.operation) || !initial.targetId || !initial.conversationId || !initial.promptMessageId) return initial ?? null;
    if (["completed", "failed", "cancelled"].includes(initial.status) || await this.cancellation(jobId)) return this.current(jobId);
    const leaseTarget = { projectId: initial.projectId, targetType: "building_block" as const, targetId: initial.targetId };
    let heartbeat: ReturnType<typeof setInterval> | undefined; let cancellationMonitor: ReturnType<typeof setInterval> | undefined;
    let leaseAcquired = false; let leaseLost = false; const providerAbort = new AbortController();
    try {
      try { await this.leases.acquire(initial.actorUserId, leaseTarget); leaseAcquired = true; }
      catch (error) { if (error instanceof DomainError && error.code === "CONFLICT") throw new AIError("AI_BLOCK_CONFLICT", "This Building Block is currently being updated by another collaborator."); throw error; }
      heartbeat = setInterval(() => { void this.leases.renew(initial.actorUserId, leaseTarget).catch(() => { leaseLost = true; }); }, 20_000);
      cancellationMonitor = setInterval(() => { void this.current(jobId).then((job) => { if (job?.cancelRequestedAt || job?.status === "cancelled") providerAbort.abort(new DOMException("Job cancelled", "AbortError")); }).catch(() => undefined); }, 1_000);

      const [prompt] = await this.database.select().from(aiMessages).where(and(eq(aiMessages.id, initial.promptMessageId), eq(aiMessages.conversationId, initial.conversationId))).limit(1);
      if (!prompt) throw new AIError("AI_INTERNAL_ERROR", "The Building Block request message is missing.");
      const [block] = await this.database.select().from(buildingBlocks).where(and(eq(buildingBlocks.id, initial.targetId), eq(buildingBlocks.projectId, initial.projectId), isNull(buildingBlocks.deletedAt))).limit(1);
      if (!block) throw new AIError("AI_BLOCK_STALE", "This Building Block is no longer available.");
      const [base] = initial.baseBlockVersionId
        ? await this.database.select().from(buildingBlockVersions).where(and(eq(buildingBlockVersions.id, initial.baseBlockVersionId), eq(buildingBlockVersions.projectId, initial.projectId), eq(buildingBlockVersions.buildingBlockId, initial.targetId))).limit(1)
        : [];
      if (initial.baseBlockVersionId && !base) throw new AIError("AI_BLOCK_STALE", "This Building Block changed while Canvas was working. Try your request again using the latest version.");

      const selectedRows = await this.database.select({ asset: mediaAssets }).from(generationJobMedia)
        .innerJoin(mediaAssets, and(eq(mediaAssets.id, generationJobMedia.mediaAssetId), eq(mediaAssets.projectId, generationJobMedia.projectId)))
        .where(and(eq(generationJobMedia.generationJobId, jobId), eq(generationJobMedia.projectId, initial.projectId), isNull(mediaAssets.deletedAt))).orderBy(generationJobMedia.position);
      const selected = selectedRows.map(({ asset }) => asset);
      const expectedMediaCount = (await this.database.select().from(generationJobMedia).where(eq(generationJobMedia.generationJobId, jobId))).length;
      if (selected.length !== expectedMediaCount) throw new AIError("AI_PROVIDER_INVALID_RESPONSE", "One or more attached Media items are no longer available.");
      const selectedElement = readResolvedSelection(initial.contextMetadata);
      if (selectedElement) {
        if (!base || !findEditableElement(base.manifest, selectedElement.canvasId)) elementStale();
      }
      const existingIds = base && base.manifest && typeof base.manifest === "object" && "referencedMediaIds" in base.manifest && Array.isArray(base.manifest.referencedMediaIds)
        ? base.manifest.referencedMediaIds.filter((id): id is string => typeof id === "string") : [];
      const contextMediaIds = [...new Set([...selected.map(({ id }) => id), ...existingIds])];

      const context = await this.contextBuilder.build({ projectId: initial.projectId, actorUserId: initial.actorUserId, target: { type: "building_block", id: initial.targetId }, selectedMediaIds: contextMediaIds, conversationId: initial.conversationId, operation: initial.operation });
      const fingerprint = createHash("sha256").update(`${context.fingerprint}:${initial.baseBlockVersionId ?? "unbuilt"}`).digest("hex");
      await this.database.update(generationJobs).set({ contextFingerprint: fingerprint, contextMetadata: { ...context.composition, baseBlockVersionId: initial.baseBlockVersionId, selectedMediaCount: selected.length, selectedElement } }).where(eq(generationJobs.id, jobId));
      observe.generationJob("started", { jobId, projectId: initial.projectId, operation: initial.operation, targetId: initial.targetId });
      if (leaseLost) throw new AIError("AI_BLOCK_CONFLICT", "This Building Block is currently being updated by another collaborator.");
      if (await this.cancellation(jobId)) return this.current(jobId);

      await this.lifecycle.transition(jobId, "generating", "Generating block");
      const imageParts = await Promise.all(selected.map(async (asset) => {
        const binary = await new MediaService().readBinary(initial.actorUserId, asset.id);
        if (binary.asset.projectId !== initial.projectId) throw new AIError("AI_PROVIDER_INVALID_RESPONSE", "Attached Media is unavailable.");
        return { mimeType: asset.mimeType, data: binary.bytes, mediaId: asset.id, displayName: asset.displayName };
      }));
      // project → selected connection → selected enabled model → adapter, resolved and
      // decrypted here rather than carried in the job payload.
      const { provider, resolved } = await this.providerResolver(initial.actorUserId);
      const usageWorkspaceId = await workspaceOfProject(initial.projectId, this.database);
      const promptVersion = blockPromptVersion({ modifying: Boolean(base), elementScoped: Boolean(selectedElement) });
      await this.database.update(generationJobs).set({ provider: resolved.connection.provider, providerModel: resolved.model.modelId, aiConnectionId: resolved.connection.id, promptVersion }).where(eq(generationJobs.id, jobId));

      const providerRequest = assembleBlockGenerationRequest({ context, userRequest: prompt.content, currentSource: base?.sourceCode ?? null, selectedElement, block: { name: block.name, kind: block.kind, isGlobal: block.isGlobal }, imageParts, signal: providerAbort.signal });
      const approved = new Set(context.media.map(({ id }) => id));
      const activeRoutes = new Set(context.structure.pages.filter((page) => page.type === "page" && page.route).map((page) => page.route!));
      const pricing = pricingFrom(resolved.model);
      const record: ProviderCallRecorder = async (entry) => {
        const row = await recordAIUsage({
          workspaceId: usageWorkspaceId, projectId: initial.projectId, connectionId: resolved.connection.id, generationJobId: jobId, actorUserId: initial.actorUserId,
          provider: resolved.connection.provider, modelId: resolved.model.modelId, requestKind: entry.requestKind, operation: initial.operation,
          promptVersion: entry.promptVersion, succeeded: entry.succeeded, errorCode: entry.errorCode, usage: entry.usage, pricing,
          providerLatencyMs: entry.providerLatencyMs, validationDurationMs: entry.validationDurationMs,
        }, this.database);
        return row?.id ?? null;
      };

      const run = await generateWithRepair({
        provider, request: providerRequest, schema: generatedBlockResponseSchema, promptVersion, record,
        // Provider metadata is useful even if deterministic validation rejects the
        // candidate. Invalid source stays ephemeral and is never activated or persisted.
        onCandidate: async (candidate) => { await this.database.update(generationJobs).set({ provider: candidate.provider, providerModel: candidate.model, providerRequestId: candidate.providerRequestId, usageMetadata: candidate.usage }).where(eq(generationJobs.id, jobId)); },
        validate: async (data) => {
          const repaired = repairGeneratedCanvasIds(data.sourceCode);
          const manifest = await validateGeneratedBlockSource({ sourceCode: repaired.sourceCode, approvedMediaIds: approved, activeRoutes, declaredMediaIds: data.referencedMediaIds });
          if (selectedElement) {
            const { targetCanvasId, targetRemoved } = data;
            if (targetCanvasId && targetCanvasId !== selectedElement.canvasId) elementInvalid(`target mismatch: ${targetCanvasId}`);
            if (!targetRemoved && !manifest.editableElements.some((element) => element.canvasId === selectedElement.canvasId)) elementInvalid("selected element missing from result");
          }
          return { manifest, sourceCode: repaired.sourceCode };
        },
      });
      const response = run.response;
      const manifest: GeneratedBlockManifest = run.validated.manifest;
      const repaired = { sourceCode: run.validated.sourceCode };
      if (!response.structuredData) throw new AIError("AI_PROVIDER_INVALID_RESPONSE", "Canvas could not produce a valid Building Block from this request. Try again.");

      if (await this.cancellation(jobId)) return this.current(jobId);
      await this.lifecycle.transition(jobId, "validating", "Validating block", { providerLatencyMs: run.providerLatencyMs, validationDurationMs: run.validationDurationMs, repairAttemptCount: run.repairAttempts });

      if (leaseLost) throw new AIError("AI_BLOCK_CONFLICT", "This Building Block is currently being updated by another collaborator.");
      if (await this.cancellation(jobId)) return this.current(jobId);

      await this.lifecycle.transition(jobId, "applying", "Applying block update");
      await this.access.requireProjectAccess(initial.actorUserId, initial.projectId);
      const completed = await this.commit({ jobId, sourceCode: repaired.sourceCode, manifest, summary: response.structuredData.summary, provider: response.provider, model: response.model, providerRequestId: response.providerRequestId, usage: response.usage });
      const jobDurationMs = performance.now() - startedAt;
      await attachJobDuration(jobId, jobDurationMs, this.database);
      observe.generationJob("completed", { jobId, projectId: initial.projectId, operation: initial.operation, targetId: initial.targetId, durationMs: jobDurationMs, providerLatencyMs: run.providerLatencyMs, repairAttempts: run.repairAttempts, promptVersion });
      return completed;
    } catch (cause) {
      const error = cause instanceof DomainError && cause.code === "ACCESS_DENIED" ? new AIError("AI_BLOCK_CONFLICT", "You no longer have access to update this Building Block.") : safeAIError(cause);
      const current = await this.current(jobId);
      if (!current || ["completed", "failed", "cancelled"].includes(current.status)) return current ?? null;
      if (current.cancelRequestedAt || error.code === "AI_JOB_CANCELLED") await this.lifecycle.transition(jobId, "cancelled", "Cancelled", { errorCode: "AI_JOB_CANCELLED", errorMessage: "The AI request was cancelled." });
      else if (error.retryable && current.attemptCount < 3) await this.lifecycle.transition(jobId, "queued", "Queued for retry", { availableAt: new Date(Date.now() + 1_000 * 2 ** Math.max(0, current.attemptCount - 1)), claimedAt: null, workerId: null, errorCode: error.code, errorMessage: error.message });
      else {
        const errorDiagnostic = persistedGenerationDiagnostic(error.diagnostic);
        const pipelineStage = failureStage(error, current.progressStage);
        await this.lifecycle.transition(jobId, "failed", "Failed", { errorCode: error.code, errorMessage: error.message, errorDiagnostic });
        await attachJobDuration(jobId, performance.now() - startedAt, this.database);
        await this.database.insert(auditEvents).values({ projectId: current.projectId, userId: current.actorUserId, action: "ai.block_generation_failed", entityType: "generation_job", entityId: jobId, metadata: { errorCode: error.code, validationRule: errorDiagnostic } });
        observe.generationJob("failed", { jobId, projectId: current.projectId, operation: current.operation, targetId: current.targetId, reason: error.code, durationMs: performance.now() - startedAt, pipelineStage, provider: current.provider, model: current.providerModel, diagnostic: errorDiagnostic });
        if (["AI_RESPONSE_SCHEMA_INVALID", "AI_RESPONSE_MALFORMED", "AI_GENERATED_SOURCE_INVALID"].includes(error.code)) observe.validationFailed("block", { projectId: current.projectId, jobId, entityId: current.targetId ?? undefined, reason: error.code, diagnostic: errorDiagnostic, pipelineStage, provider: current.provider, model: current.providerModel });
      }
      return this.current(jobId);
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      if (cancellationMonitor) clearInterval(cancellationMonitor);
      if (leaseAcquired) await this.leases.releaseForWorker(initial.actorUserId, leaseTarget).catch(() => undefined);
    }
  }

  private async commit(input: { jobId: string; sourceCode: string; manifest: GeneratedBlockManifest; summary: BlockChangeSummary; provider: string; model: string; providerRequestId?: string; usage?: unknown }) {
    return this.database.transaction(async (transaction) => {
      const [job] = await transaction.select().from(generationJobs).where(eq(generationJobs.id, input.jobId)).for("update");
      if (!job) throw new AIError("AI_INTERNAL_ERROR", "Generation job not found.");
      if (job.status === "completed" && job.resultBlockVersionId) return job;
      if (job.cancelRequestedAt || job.status === "cancelled") throw new AIError("AI_JOB_CANCELLED", "The AI request was cancelled.");
      if (job.status !== "applying" || !job.targetId || !job.conversationId) throw new AIError("AI_INTERNAL_ERROR", "Generation job is not ready to apply.");
      const [block] = await transaction.select().from(buildingBlocks).where(and(eq(buildingBlocks.id, job.targetId), eq(buildingBlocks.projectId, job.projectId), isNull(buildingBlocks.deletedAt))).for("update");
      if (!block) throw new AIError("AI_BLOCK_STALE", "This Building Block changed while Canvas was working. Try your request again using the latest version.");
      if (block.currentVersionId !== job.baseBlockVersionId) {
        observe.validationFailed("block", { projectId: job.projectId, jobId: job.id, entityId: block.id, reason: "AI_BLOCK_STALE" });
        throw new AIError("AI_BLOCK_STALE", "This Building Block changed while Canvas was working. Try your request again using the latest version.");
      }
      // Worker retries reuse the version already written for this job instead of
      // creating a duplicate.
      const [existing] = await transaction.select().from(buildingBlockVersions).where(eq(buildingBlockVersions.generationJobId, job.id)).limit(1);
      if (existing) return (await transaction.update(generationJobs).set({ status: "completed", progressStage: "Completed", resultBlockVersionId: existing.id, finishedAt: new Date() }).where(eq(generationJobs.id, job.id)).returning())[0]!;
      const [latest] = await transaction.select({ versionNumber: buildingBlockVersions.versionNumber }).from(buildingBlockVersions).where(and(eq(buildingBlockVersions.projectId, job.projectId), eq(buildingBlockVersions.buildingBlockId, block.id))).orderBy(desc(buildingBlockVersions.versionNumber)).limit(1);
      const versionId = randomUUID();
      const changeSet = await recordChangeSet(transaction, {
        projectId: job.projectId, actorUserId: job.actorUserId, operation: job.operation === "block_generate" ? "block_generate" : "block_modify",
        summary: `${block.name}: ${input.summary.headline}`, generationJobId: job.id,
        items: [{ entityType: "building_block", entityId: block.id, beforeVersionId: job.baseBlockVersionId, afterVersionId: versionId }],
      });
      const [version] = await transaction.insert(buildingBlockVersions).values({
        id: versionId, changeSetId: changeSet.id,
        projectId: job.projectId, buildingBlockId: block.id, versionNumber: (latest?.versionNumber ?? 0) + 1,
        sourceCode: input.sourceCode, manifest: input.manifest, changeSummary: input.summary,
        sourceHash: input.manifest.sourceHash, createdByUserId: job.actorUserId, generationJobId: job.id,
      }).returning();
      if (!version) throw new AIError("AI_INTERNAL_ERROR", "Building Block version could not be created.");
      await transaction.update(buildingBlocks).set({ currentVersionId: version.id, updatedAt: new Date() }).where(eq(buildingBlocks.id, block.id));
      const [message] = await transaction.insert(aiMessages).values({ conversationId: job.conversationId, role: "assistant", content: summaryMessage(input.summary), metadata: { generationJobId: job.id, buildingBlockVersionId: version.id, summary: input.summary } }).returning();
      const [completed] = await transaction.update(generationJobs).set({ status: "completed", progressStage: "Completed", resultBlockVersionId: version.id, resultChangeSetId: changeSet.id, resultMessageId: message?.id, provider: input.provider, providerModel: input.model, providerRequestId: input.providerRequestId, usageMetadata: input.usage, finishedAt: new Date() }).where(eq(generationJobs.id, job.id)).returning();
      await transaction.insert(auditEvents).values([
        { projectId: job.projectId, userId: job.actorUserId, action: "block.version_created", entityType: "building_block_version", entityId: version.id, metadata: { blockId: block.id, versionNumber: version.versionNumber } },
        { projectId: job.projectId, userId: job.actorUserId, action: "block.version_activated", entityType: "building_block_version", entityId: version.id, metadata: { blockId: block.id } },
        { projectId: job.projectId, userId: job.actorUserId, action: "ai.block_generation_completed", entityType: "generation_job", entityId: job.id, metadata: { blockId: block.id, versionId: version.id } },
      ]);
      if (!completed) throw new AIError("AI_INTERNAL_ERROR", "Generation job could not be completed.");
      return completed;
    });
  }
}
