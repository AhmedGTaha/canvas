import { createHash } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, type Database } from "@/server/db/client";
import { aiMessages, auditEvents, buildingBlockVersions, buildingBlocks, generationJobMedia, generationJobs, mediaAssets } from "@/server/db/schema";
import { getAIProvider } from "@/server/ai/provider-registry";
import { ProjectAccessService } from "@/server/permissions/project-access";
import { MediaService } from "@/domain/media/service";
import { EditingLeaseService } from "@/domain/collaboration/lease-service";
import { DomainError } from "@/domain/shared/errors";
import { AIError, type AIProvider } from "@/domain/ai/provider";
import { ProjectContextBuilder } from "@/domain/ai/context";
import { GenerationJobLifecycle, safeAIError } from "@/domain/ai/job-service";
import { validateGeneratedBlockSource, type GeneratedBlockManifest } from "@/domain/blocks/validation";
import { generatedBlockResponseSchema, type BlockChangeSummary } from "./contract";
import { assembleBlockGenerationRequest } from "./prompt";

function summaryMessage(summary: BlockChangeSummary) {
  return [summary.headline, ...summary.changes.map((item) => `• ${item}`), ...summary.limitations.map((item) => `Limitation: ${item}`)].join("\n");
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
    private readonly providerResolver: () => AIProvider = getAIProvider,
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
      const existingIds = base && base.manifest && typeof base.manifest === "object" && "referencedMediaIds" in base.manifest && Array.isArray(base.manifest.referencedMediaIds)
        ? base.manifest.referencedMediaIds.filter((id): id is string => typeof id === "string") : [];
      const contextMediaIds = [...new Set([...selected.map(({ id }) => id), ...existingIds])];

      const context = await this.contextBuilder.build({ projectId: initial.projectId, actorUserId: initial.actorUserId, target: { type: "building_block", id: initial.targetId }, selectedMediaIds: contextMediaIds, conversationId: initial.conversationId, operation: initial.operation });
      const fingerprint = createHash("sha256").update(`${context.fingerprint}:${initial.baseBlockVersionId ?? "unbuilt"}`).digest("hex");
      await this.database.update(generationJobs).set({ contextFingerprint: fingerprint, contextMetadata: { ...context.composition, baseBlockVersionId: initial.baseBlockVersionId, selectedMediaCount: selected.length } }).where(eq(generationJobs.id, jobId));
      console.info(JSON.stringify({ event: "ai.block_context.prepared", jobId, blockId: initial.targetId, ...context.composition }));
      if (leaseLost) throw new AIError("AI_BLOCK_CONFLICT", "This Building Block is currently being updated by another collaborator.");
      if (await this.cancellation(jobId)) return this.current(jobId);

      await this.lifecycle.transition(jobId, "generating", "Generating block");
      const imageParts = await Promise.all(selected.map(async (asset) => {
        const binary = await new MediaService().readBinary(initial.actorUserId, asset.id);
        if (binary.asset.projectId !== initial.projectId) throw new AIError("AI_PROVIDER_INVALID_RESPONSE", "Attached Media is unavailable.");
        return { mimeType: asset.mimeType, data: binary.bytes, mediaId: asset.id, displayName: asset.displayName };
      }));
      const provider = this.providerResolver();
      console.info(JSON.stringify({ event: "ai.provider.request_started", jobId, provider: provider.name, model: provider.model, operation: initial.operation }));
      const response = await provider.generateStructured(assembleBlockGenerationRequest({ context, userRequest: prompt.content, currentSource: base?.sourceCode ?? null, block: { name: block.name, kind: block.kind, isGlobal: block.isGlobal }, imageParts, signal: providerAbort.signal }), generatedBlockResponseSchema);
      if (!response.structuredData) throw new AIError("AI_PROVIDER_INVALID_RESPONSE", "Canvas could not produce a valid Building Block from this request. Try again.");
      console.info(JSON.stringify({ event: "ai.provider.request_completed", jobId, provider: response.provider, model: response.model, operation: initial.operation }));
      if (await this.cancellation(jobId)) return this.current(jobId);

      await this.lifecycle.transition(jobId, "validating", "Validating block");
      const approved = new Set(context.media.map(({ id }) => id));
      const activeRoutes = new Set(context.structure.pages.filter((page) => page.type === "page" && page.route).map((page) => page.route!));
      const manifest = await validateGeneratedBlockSource({ sourceCode: response.structuredData.sourceCode, approvedMediaIds: approved, activeRoutes, declaredMediaIds: response.structuredData.referencedMediaIds });
      console.info(JSON.stringify({ event: "ai.block_source_validation.completed", jobId, sourceHash: manifest.sourceHash }));
      if (leaseLost) throw new AIError("AI_BLOCK_CONFLICT", "This Building Block is currently being updated by another collaborator.");
      if (await this.cancellation(jobId)) return this.current(jobId);

      await this.lifecycle.transition(jobId, "applying", "Applying block update");
      await this.access.requireProjectAccess(initial.actorUserId, initial.projectId);
      const completed = await this.commit({ jobId, sourceCode: response.structuredData.sourceCode, manifest, summary: response.structuredData.summary, provider: response.provider, model: response.model, providerRequestId: response.providerRequestId, usage: response.usage });
      console.info(JSON.stringify({ event: "ai.block_version.committed", jobId, blockId: initial.targetId, versionId: completed.resultBlockVersionId }));
      return completed;
    } catch (cause) {
      const error = cause instanceof DomainError && cause.code === "ACCESS_DENIED" ? new AIError("AI_BLOCK_CONFLICT", "You no longer have access to update this Building Block.") : safeAIError(cause);
      const current = await this.current(jobId);
      if (!current || ["completed", "failed", "cancelled"].includes(current.status)) return current ?? null;
      if (current.cancelRequestedAt || error.code === "AI_JOB_CANCELLED") await this.lifecycle.transition(jobId, "cancelled", "Cancelled", { errorCode: "AI_JOB_CANCELLED", errorMessage: "The AI request was cancelled." });
      else if (error.retryable && current.attemptCount < 3) await this.lifecycle.transition(jobId, "queued", "Queued for retry", { availableAt: new Date(Date.now() + 1_000 * 2 ** Math.max(0, current.attemptCount - 1)), claimedAt: null, workerId: null, errorCode: error.code, errorMessage: error.message });
      else {
        await this.lifecycle.transition(jobId, "failed", "Failed", { errorCode: error.code, errorMessage: error.message });
        await this.database.insert(auditEvents).values({ projectId: current.projectId, userId: current.actorUserId, action: "ai.block_generation_failed", entityType: "generation_job", entityId: jobId, metadata: { errorCode: error.code } });
        console.error(JSON.stringify({ event: "ai.block_generation.failed", jobId, errorCode: error.code, diagnostic: error.diagnostic }));
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
        console.warn(JSON.stringify({ event: "ai.block_stale_rejected", jobId: job.id, blockId: block.id }));
        throw new AIError("AI_BLOCK_STALE", "This Building Block changed while Canvas was working. Try your request again using the latest version.");
      }
      // Worker retries reuse the version already written for this job instead of
      // creating a duplicate.
      const [existing] = await transaction.select().from(buildingBlockVersions).where(eq(buildingBlockVersions.generationJobId, job.id)).limit(1);
      if (existing) return (await transaction.update(generationJobs).set({ status: "completed", progressStage: "Completed", resultBlockVersionId: existing.id, finishedAt: new Date() }).where(eq(generationJobs.id, job.id)).returning())[0]!;
      const [latest] = await transaction.select({ versionNumber: buildingBlockVersions.versionNumber }).from(buildingBlockVersions).where(and(eq(buildingBlockVersions.projectId, job.projectId), eq(buildingBlockVersions.buildingBlockId, block.id))).orderBy(desc(buildingBlockVersions.versionNumber)).limit(1);
      const [version] = await transaction.insert(buildingBlockVersions).values({
        projectId: job.projectId, buildingBlockId: block.id, versionNumber: (latest?.versionNumber ?? 0) + 1,
        sourceCode: input.sourceCode, manifest: input.manifest, changeSummary: input.summary,
        sourceHash: input.manifest.sourceHash, createdByUserId: job.actorUserId, generationJobId: job.id,
      }).returning();
      if (!version) throw new AIError("AI_INTERNAL_ERROR", "Building Block version could not be created.");
      await transaction.update(buildingBlocks).set({ currentVersionId: version.id, updatedAt: new Date() }).where(eq(buildingBlocks.id, block.id));
      const [message] = await transaction.insert(aiMessages).values({ conversationId: job.conversationId, role: "assistant", content: summaryMessage(input.summary), metadata: { generationJobId: job.id, buildingBlockVersionId: version.id, summary: input.summary } }).returning();
      const [completed] = await transaction.update(generationJobs).set({ status: "completed", progressStage: "Completed", resultBlockVersionId: version.id, resultMessageId: message?.id, provider: input.provider, providerModel: input.model, providerRequestId: input.providerRequestId, usageMetadata: input.usage, finishedAt: new Date() }).where(eq(generationJobs.id, job.id)).returning();
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
