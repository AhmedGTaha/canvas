import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { db, type Database } from "@/server/db/client";
import { aiMessages, auditEvents, generationJobMedia, generationJobs, mediaAssets, pageNodes, pageVersions } from "@/server/db/schema";
import { resolveActorProvider, type ResolvedActorModel } from "@/domain/ai/connections/model-resolution";
import { attachJobDuration, pricingFrom, recordAIUsage, workspaceOfProject } from "@/domain/ai/analytics/usage-service";
import { generateWithRepair, type ProviderCallRecorder } from "@/domain/ai/generation-runner";
import { ProjectAccessService } from "@/server/permissions/project-access";
import { MediaService } from "@/domain/media/service";
import { EditingLeaseService } from "@/domain/collaboration/lease-service";
import { DomainError } from "@/domain/shared/errors";
import { AIError, type AIProvider } from "@/domain/ai/provider";
import { ProjectContextBuilder, type ProjectAIContext } from "@/domain/ai/context";
import { GenerationJobLifecycle, safeAIError } from "@/domain/ai/job-service";
import { reconcilePageBlockUsages } from "@/domain/blocks/usages";
import { recordChangeSet } from "@/domain/history/change-set-service";
import type { GeneratedBlockUsage } from "@/domain/generated-source/validator";
import { elementInvalid, elementStale, findEditableElement, readResolvedSelection } from "@/domain/generated-source/selection";
import { generatedPageResponseSchema, pageDocumentFrom, type PageChangeSummary } from "./contract";
import { assemblePageGenerationRequest, pagePromptVersion } from "./prompt";
import { validateGeneratedPageDocument, type GeneratedPageManifest } from "./validator";
import { pageDesignPlanBundleSchema, persistedDesignPlanFrom, validatePageDesignPlanBundle, type PageDesignPlan, type PersistedDesignPlan } from "./design-plan";
import { assemblePageDesignPlanRequest, conflictingCompositionNote } from "./design-plan-prompt";
import { assertCandidateDiversity, compositionFingerprintFrom, mostSimilar, MAX_ACCEPTABLE_PAGE_COMPOSITION_SIMILARITY, type CompositionFingerprint } from "./composition-fingerprint";
import { checkDesignPlanConformance } from "./design-plan-conformance";
import { CANVAS_PROMPT_VERSIONS } from "@/domain/ai/prompts/versions";
import type { GeneratedDocument } from "@/domain/generated-source/document";
import { isLegacyVersion, versionDocument } from "@/domain/generated-source/stored-version";
import { observe } from "@/server/observability/events";
import { documentValidationStage, persistedGenerationDiagnostic } from "@/domain/generated-source/diagnostics";
import { repairGeneratedCanvasIds } from "@/domain/generated-source/canvas-id-repair";

function summaryMessage(summary: PageChangeSummary) { return [summary.headline, ...summary.changes.map((item) => `• ${item}`), ...summary.limitations.map((item) => `Limitation: ${item}`)].join("\n"); }
function failureStage(error: AIError, fallback: string) {
  if (error.code === "AI_RESPONSE_SCHEMA_INVALID") return "response_schema";
  if (error.code === "AI_RESPONSE_MALFORMED") return "response_parse";
  if (error.code === "AI_RESPONSE_EMPTY" || error.code === "AI_RESPONSE_TRUNCATED") return "provider_response";
  if (error.code === "AI_GENERATED_DOCUMENT_INVALID") return documentValidationStage(error.diagnostic ?? "");
  return fallback;
}

/** A static page may safely lose unsolicited behaviour; an explicitly interactive page may not. */
function requestsInteractivity(request: string) {
  return /\b(?:interactive|interactivity|accordion|modal|toggle|dropdown|carousel|slideshow|filter(?:ing)?|search(?:able)?|calculator|form validation|animation)\b/i.test(request);
}

function canDiscardUnsafeJavaScript(input: { operation: string; selectedElement: unknown; request: string; error: unknown }) {
  return input.operation === "page_generate"
    && !input.selectedElement
    && !requestsInteractivity(input.request)
    && input.error instanceof AIError
    && input.error.code === "AI_GENERATED_DOCUMENT_INVALID"
    && /^unsafe JavaScript/i.test(input.error.diagnostic ?? "");
}

/**
 * Resolves the credential for a job at execution time, from the account of the person who
 * created it. The job carries the actor's id and nothing else; the key itself is fetched,
 * decrypted, used and discarded inside the worker.
 */
export type ActorProviderResolver = (actorUserId: string) => Promise<{ resolved: ResolvedActorModel; provider: AIProvider }>;

export class PageGenerationOrchestrationService {
  constructor(private readonly database: Database = db, private readonly contextBuilder = new ProjectContextBuilder(), private readonly lifecycle = new GenerationJobLifecycle(database), private readonly providerResolver: ActorProviderResolver = (actorUserId) => resolveActorProvider(actorUserId, database), private readonly leases = new EditingLeaseService(), private readonly access = new ProjectAccessService()) {}
  private async current(jobId: string) { const [job] = await this.database.select().from(generationJobs).where(eq(generationJobs.id, jobId)).limit(1); return job; }

  /**
   * Composition fingerprints for the current version of every *other* built page in the
   * project. Legacy pages with no design-plan metadata are skipped rather than guessed,
   * and global Building Block furniture is intentionally excluded because it never enters
   * a fingerprint. The target page is ignored so a regeneration never conflicts with itself.
   */
  private async loadProjectCompositionFingerprints(projectId: string, targetPageId: string): Promise<CompositionFingerprint[]> {
    const rows = await this.database
      .select({ manifest: pageVersions.manifest })
      .from(pageNodes)
      .innerJoin(pageVersions, and(eq(pageVersions.id, pageNodes.currentVersionId), eq(pageVersions.projectId, pageNodes.projectId)))
      .where(and(eq(pageNodes.projectId, projectId), eq(pageNodes.type, "page"), isNull(pageNodes.deletedAt), ne(pageNodes.id, targetPageId)));
    const fingerprints: CompositionFingerprint[] = [];
    for (const row of rows) {
      const fingerprint = (row.manifest as GeneratedPageManifest | null)?.designPlan?.compositionFingerprint;
      if (fingerprint && typeof fingerprint === "object" && fingerprint.version === 1) fingerprints.push(fingerprint);
    }
    return fingerprints;
  }

  /** One planning call returning three validated, diverse candidate plans and the selection. */
  private async generatePlanBundle(args: { provider: AIProvider; record: ProviderCallRecorder; context: ProjectAIContext; userRequest: string; imageParts: Array<{ mimeType: string; data: Uint8Array; mediaId: string; displayName: string }>; signal: AbortSignal; replanNote?: string }): Promise<{ selected: PageDesignPlan }> {
    const request = assemblePageDesignPlanRequest({ context: args.context, userRequest: args.userRequest, imageParts: args.imageParts, replanNote: args.replanNote ?? null, signal: args.signal });
    const run = await generateWithRepair({
      provider: args.provider, request, schema: pageDesignPlanBundleSchema, promptVersion: CANVAS_PROMPT_VERSIONS.page_design_plan, record: args.record, maxRepairAttempts: 0,
      validate: async (data) => { const { bundle, selected } = validatePageDesignPlanBundle(data); assertCandidateDiversity(bundle); return { selected }; },
    });
    return run.validated;
  }
  private async cancellation(jobId: string) { const job = await this.current(jobId); if (!job) return true; if (!job.cancelRequestedAt && job.status !== "cancelled") return false; if (!(["completed", "failed", "cancelled"] as string[]).includes(job.status)) await this.lifecycle.transition(jobId, "cancelled", "Cancelled", { errorCode: "AI_JOB_CANCELLED", errorMessage: "The AI request was cancelled." }); return true; }

  async process(jobId: string) {
    const startedAt = performance.now();
    const initial = await this.current(jobId);
    if (!initial || !["page_generate", "page_modify"].includes(initial.operation) || !initial.targetId || !initial.conversationId || !initial.promptMessageId) return initial ?? null;
    if (["completed", "failed", "cancelled"].includes(initial.status) || await this.cancellation(jobId)) return this.current(jobId);
    const leaseTarget = { projectId: initial.projectId, targetType: "page" as const, targetId: initial.targetId };
    let heartbeat: ReturnType<typeof setInterval> | undefined; let cancellationMonitor: ReturnType<typeof setInterval> | undefined; let leaseAcquired = false; let leaseLost = false; const providerAbort = new AbortController();
    try {
      try { await this.leases.acquire(initial.actorUserId, leaseTarget); leaseAcquired = true; }
      catch (error) { if (error instanceof DomainError && error.code === "CONFLICT") throw new AIError("AI_PAGE_CONFLICT", "This page is currently being updated by another collaborator."); throw error; }
      heartbeat = setInterval(() => { void this.leases.renew(initial.actorUserId, leaseTarget).catch(() => { leaseLost = true; }); }, 20_000);
      cancellationMonitor = setInterval(() => { void this.current(jobId).then((job) => { if (job?.cancelRequestedAt || job?.status === "cancelled") providerAbort.abort(new DOMException("Job cancelled", "AbortError")); }).catch(() => undefined); }, 1_000);
      const [prompt] = await this.database.select().from(aiMessages).where(and(eq(aiMessages.id, initial.promptMessageId), eq(aiMessages.conversationId, initial.conversationId))).limit(1);
      if (!prompt) throw new AIError("AI_INTERNAL_ERROR", "The page request message is missing.");
      const [base] = initial.basePageVersionId ? await this.database.select().from(pageVersions).where(and(eq(pageVersions.id, initial.basePageVersionId), eq(pageVersions.projectId, initial.projectId), eq(pageVersions.pageId, initial.targetId))).limit(1) : [];
      if (initial.basePageVersionId && !base) throw new AIError("AI_PAGE_STALE", "This page changed while Canvas was working. Try your request again using the latest version.");
      const selectedRows = await this.database.select({ asset: mediaAssets }).from(generationJobMedia).innerJoin(mediaAssets, and(eq(mediaAssets.id, generationJobMedia.mediaAssetId), eq(mediaAssets.projectId, generationJobMedia.projectId))).where(and(eq(generationJobMedia.generationJobId, jobId), eq(generationJobMedia.projectId, initial.projectId), isNull(mediaAssets.deletedAt))).orderBy(generationJobMedia.position);
      const selected = selectedRows.map(({ asset }) => asset);
      const expectedMediaCount = (await this.database.select().from(generationJobMedia).where(eq(generationJobMedia.generationJobId, jobId))).length;
      if (selected.length !== expectedMediaCount) throw new AIError("AI_PROVIDER_INVALID_RESPONSE", "One or more attached Media items are no longer available.");
      // The selection was resolved against the version that was active when the job was
      // created; it must still exist in the baseline this job is actually modifying.
      const selectedElement = readResolvedSelection(initial.contextMetadata);
      if (selectedElement) {
        if (!base || isLegacyVersion(base) || !findEditableElement(base.manifest, selectedElement.canvasId)) elementStale();
      }
      // A Version written before the static-document format cannot be edited in place:
      // there is no safe way to turn a compiled React component back into markup. The
      // request becomes a rebuild of the page instead of a modification of it, which is
      // the only outcome that leaves the user with a working page.
      const baseDocument = versionDocument(base ?? null);
      const existingIds = base && base.manifest && typeof base.manifest === "object" && "referencedMediaIds" in base.manifest && Array.isArray(base.manifest.referencedMediaIds) ? base.manifest.referencedMediaIds.filter((id): id is string => typeof id === "string") : [];
      const contextMediaIds = [...new Set([...selected.map(({ id }) => id), ...existingIds])];
      const context = await this.contextBuilder.build({ projectId: initial.projectId, actorUserId: initial.actorUserId, target: { type: "page", id: initial.targetId }, selectedMediaIds: contextMediaIds, conversationId: initial.conversationId, operation: initial.operation });
      const fingerprint = createHash("sha256").update(`${context.fingerprint}:${initial.basePageVersionId ?? "unbuilt"}`).digest("hex");
      await this.database.update(generationJobs).set({ contextFingerprint: fingerprint, contextMetadata: { ...context.composition, basePageVersionId: initial.basePageVersionId, selectedMediaCount: selected.length, selectedElement } }).where(eq(generationJobs.id, jobId));
      observe.generationJob("started", { jobId, projectId: initial.projectId, operation: initial.operation, targetId: initial.targetId });
      if (leaseLost) throw new AIError("AI_PAGE_CONFLICT", "This page is currently being updated by another collaborator.");
      if (await this.cancellation(jobId)) return this.current(jobId);
      const imageParts = await Promise.all(selected.map(async (asset) => { const binary = await new MediaService().readBinary(initial.actorUserId, asset.id); if (binary.asset.projectId !== initial.projectId) throw new AIError("AI_PROVIDER_INVALID_RESPONSE", "Attached Media is unavailable."); return { mimeType: asset.mimeType, data: binary.bytes, mediaId: asset.id, displayName: asset.displayName }; }));
      // actor → their account's selected connection → selected enabled model → adapter.
      // The credential is decrypted inside this call and never travels through the job
      // payload, the queue row, the prompt, or anything this job writes. Resolved once and
      // used for both the planning call and the source-generation call.
      const { provider, resolved } = await this.providerResolver(initial.actorUserId);
      const usageWorkspaceId = await workspaceOfProject(initial.projectId, this.database);
      const promptVersion = pagePromptVersion({ modifying: Boolean(base), elementScoped: Boolean(selectedElement) });
      await this.database.update(generationJobs).set({ provider: resolved.connection.provider, providerModel: resolved.model.modelId, aiConnectionId: resolved.connection.id, promptVersion }).where(eq(generationJobs.id, jobId));
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

      // Design planning: only unbuilt page generation gets a first-class PageDesignPlan
      // before any source. Modifications and selected-element edits keep their existing
      // preserve-unrelated semantics and never route through the planner.
      let selectedPlan: PageDesignPlan | null = null;
      let persistedPlan: PersistedDesignPlan<CompositionFingerprint> | null = null;
      let replanCount = 0; let triggeringSimilarity: number | null = null;
      if (initial.operation === "page_generate" && !base && !selectedElement) {
        await this.database.update(generationJobs).set({ progressStage: "Planning page" }).where(eq(generationJobs.id, jobId));
        const existingFingerprints = await this.loadProjectCompositionFingerprints(initial.projectId, initial.targetId);
        let candidate = (await this.generatePlanBundle({ provider, record, context, userRequest: prompt.content, imageParts, signal: providerAbort.signal })).selected;
        let fingerprint = compositionFingerprintFrom(candidate);
        const match = mostSimilar(fingerprint, existingFingerprints);
        if (match && match.score >= MAX_ACCEPTABLE_PAGE_COMPOSITION_SIMILARITY) {
          triggeringSimilarity = match.score;
          if (leaseLost) throw new AIError("AI_PAGE_CONFLICT", "This page is currently being updated by another collaborator.");
          if (await this.cancellation(jobId)) return this.current(jobId);
          candidate = (await this.generatePlanBundle({ provider, record, context, userRequest: prompt.content, imageParts, signal: providerAbort.signal, replanNote: conflictingCompositionNote(match.fingerprint, match.score) })).selected;
          fingerprint = compositionFingerprintFrom(candidate); replanCount = 1;
          const second = mostSimilar(fingerprint, existingFingerprints);
          if (second && second.score >= MAX_ACCEPTABLE_PAGE_COMPOSITION_SIMILARITY) throw new AIError("AI_DESIGN_PLAN_TOO_SIMILAR", "Canvas kept designing this page too much like another page in the project. Try a more specific request describing what makes this page different.");
        }
        selectedPlan = candidate;
        persistedPlan = persistedDesignPlanFrom(candidate, fingerprint);
        await this.database.update(generationJobs).set({ contextMetadata: { ...context.composition, basePageVersionId: initial.basePageVersionId, selectedMediaCount: selected.length, selectedElement, designPlanId: selectedPlan.id, planPromptVersion: CANVAS_PROMPT_VERSIONS.page_design_plan, compositionFingerprintVersion: fingerprint.version, replanCount, triggeringSimilarity } }).where(eq(generationJobs.id, jobId));
      }

      if (leaseLost) throw new AIError("AI_PAGE_CONFLICT", "This page is currently being updated by another collaborator.");
      if (await this.cancellation(jobId)) return this.current(jobId);
      await this.lifecycle.transition(jobId, "generating", "Generating page");

      const providerRequest = assemblePageGenerationRequest({ context, userRequest: prompt.content, currentDocument: baseDocument, selectedElement, selectedPlan, imageParts, signal: providerAbort.signal });
      const approved = new Set(context.media.map(({ id }) => id)); const activeRoutes = new Set(context.structure.pages.filter((page) => page.type === "page" && page.route).map((page) => page.route!));
      // Only Building Blocks declared in the assembled context, active in this project,
      // and already generated may be referenced. Anything else is a rejected reference.
      const availableBlockIds = new Set(context.blocks.filter((block) => block.currentVersionId).map((block) => block.id));

      const run = await generateWithRepair({
        provider, request: providerRequest, schema: generatedPageResponseSchema, promptVersion, record,
        onCandidate: async (candidate) => { await this.database.update(generationJobs).set({ provider: candidate.provider, providerModel: candidate.model, providerRequestId: candidate.providerRequestId, usageMetadata: candidate.usage }).where(eq(generationJobs.id, jobId)); },
        validate: async (data) => {
          const repaired = repairGeneratedCanvasIds(data.html);
          const documentInput = { ...pageDocumentFrom(data), html: repaired.html };
          let validated: ReturnType<typeof validateGeneratedPageDocument>;
          try {
            validated = validateGeneratedPageDocument({ document: documentInput, approvedMediaIds: approved, activeRoutes, declaredMediaIds: data.referencedMediaIds, availableBlockIds, declaredBlockUsages: data.blockUsages });
          } catch (error) {
            // Static informational pages do not need model-added behaviour. If that
            // behaviour is unsafe, discard it rather than letting it block the safe HTML
            // and CSS the user requested. Explicitly interactive work still fails closed.
            if (!canDiscardUnsafeJavaScript({ operation: initial.operation, selectedElement, request: prompt.content, error })) throw error;
            validated = validateGeneratedPageDocument({ document: { ...documentInput, js: "" }, approvedMediaIds: approved, activeRoutes, declaredMediaIds: data.referencedMediaIds, availableBlockIds, declaredBlockUsages: data.blockUsages });
          }
          const { manifest, document } = validated;
          if (selectedElement) {
            const { targetCanvasId, targetRemoved } = data;
            if (targetCanvasId && targetCanvasId !== selectedElement.canvasId) elementInvalid(`target mismatch: ${targetCanvasId}`);
            if (!targetRemoved && !manifest.editableElements.some((element) => element.canvasId === selectedElement.canvasId)) elementInvalid("selected element missing from result");
          }
          // Conservative output-versus-plan conformance. A failure is surfaced as a
          // repairable document defect so the bounded repair loop can correct it rather
          // than discarding an otherwise valid page.
          if (selectedPlan) {
            const conformance = checkDesignPlanConformance(selectedPlan, manifest, { mediaAvailable: approved.size > 0 });
            if (!conformance.ok) throw new AIError("AI_GENERATED_DOCUMENT_INVALID", "The generated page did not implement the selected design plan.", false, undefined, conformance.reason);
          }
          return { manifest, document };
        },
      });
      const response = run.response;
      const manifest: GeneratedPageManifest = run.validated.manifest;
      const document = run.validated.document;
      if (!response.structuredData) throw new AIError("AI_PROVIDER_INVALID_RESPONSE", "Canvas could not produce a valid page from this request. Try again.");

      if (await this.cancellation(jobId)) return this.current(jobId);
      await this.lifecycle.transition(jobId, "validating", "Validating page", { providerLatencyMs: run.providerLatencyMs, validationDurationMs: run.validationDurationMs, repairAttemptCount: run.repairAttempts });

      if (leaseLost) throw new AIError("AI_PAGE_CONFLICT", "This page is currently being updated by another collaborator.");
      if (await this.cancellation(jobId)) return this.current(jobId);
      await this.lifecycle.transition(jobId, "applying", "Applying page update");
      await this.access.requireProjectAccess(initial.actorUserId, initial.projectId);
      const completed = await this.commit({ jobId, document, manifest, designPlan: persistedPlan, summary: response.structuredData.summary, provider: response.provider, model: response.model, providerRequestId: response.providerRequestId, usage: response.usage });
      const jobDurationMs = performance.now() - startedAt;
      await attachJobDuration(jobId, jobDurationMs, this.database);
      observe.generationJob("completed", { jobId, projectId: initial.projectId, operation: initial.operation, targetId: initial.targetId, durationMs: jobDurationMs, providerLatencyMs: run.providerLatencyMs, repairAttempts: run.repairAttempts, promptVersion });
      return completed;
    } catch (cause) {
      const error = cause instanceof DomainError && cause.code === "ACCESS_DENIED" ? new AIError("AI_PAGE_CONFLICT", "You no longer have access to update this page.") : safeAIError(cause);
      const current = await this.current(jobId);
      if (!current || ["completed", "failed", "cancelled"].includes(current.status)) return current ?? null;
      if (current.cancelRequestedAt || error.code === "AI_JOB_CANCELLED") await this.lifecycle.transition(jobId, "cancelled", "Cancelled", { errorCode: "AI_JOB_CANCELLED", errorMessage: "The AI request was cancelled." });
      else if (error.retryable && current.attemptCount < 3) await this.lifecycle.transition(jobId, "queued", "Queued for retry", { availableAt: new Date(Date.now() + 1_000 * 2 ** Math.max(0, current.attemptCount - 1)), claimedAt: null, workerId: null, errorCode: error.code, errorMessage: error.message });
      else { const errorDiagnostic = persistedGenerationDiagnostic(error.diagnostic); const pipelineStage = failureStage(error, current.progressStage); await this.lifecycle.transition(jobId, "failed", "Failed", { errorCode: error.code, errorMessage: error.message, errorDiagnostic }); await attachJobDuration(jobId, performance.now() - startedAt, this.database); await this.database.insert(auditEvents).values({ projectId: current.projectId, userId: current.actorUserId, action: "ai.page_generation_failed", entityType: "generation_job", entityId: jobId, metadata: { errorCode: error.code, validationRule: errorDiagnostic } }); observe.generationJob("failed", { jobId, projectId: current.projectId, operation: current.operation, targetId: current.targetId, reason: error.code, durationMs: performance.now() - startedAt, pipelineStage, provider: current.provider, model: current.providerModel, diagnostic: errorDiagnostic }); if (["AI_RESPONSE_SCHEMA_INVALID", "AI_RESPONSE_MALFORMED", "AI_GENERATED_DOCUMENT_INVALID"].includes(error.code)) observe.validationFailed("page", { projectId: current.projectId, jobId, entityId: current.targetId ?? undefined, reason: error.code, diagnostic: errorDiagnostic, pipelineStage, provider: current.provider, model: current.providerModel }); }
      return this.current(jobId);
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      if (cancellationMonitor) clearInterval(cancellationMonitor);
      if (leaseAcquired) await this.leases.releaseForWorker(initial.actorUserId, leaseTarget).catch(() => undefined);
    }
  }

  private async reconcile(transaction: Parameters<Parameters<Database["transaction"]>[0]>[0], projectId: string, pageId: string, usages: GeneratedBlockUsage[]) {
    try {
      return await reconcilePageBlockUsages(transaction, { projectId, pageId, usages });
    } catch (error) {
      if (error instanceof AIError) throw error;
      throw new AIError("AI_PROVIDER_INVALID_RESPONSE", error instanceof DomainError ? error.message : "Canvas could not resolve the Building Blocks this page uses.");
    }
  }

  private async commit(input: { jobId: string; document: GeneratedDocument; manifest: GeneratedPageManifest; designPlan?: PersistedDesignPlan<CompositionFingerprint> | null; summary: PageChangeSummary; provider: string; model: string; providerRequestId?: string; usage?: unknown }) {
    return this.database.transaction(async (transaction) => {
      const [job] = await transaction.select().from(generationJobs).where(eq(generationJobs.id, input.jobId)).for("update");
      if (!job) throw new AIError("AI_INTERNAL_ERROR", "Generation job not found.");
      if (job.status === "completed" && job.resultPageVersionId) return job;
      if (job.cancelRequestedAt || job.status === "cancelled") throw new AIError("AI_JOB_CANCELLED", "The AI request was cancelled.");
      if (job.status !== "applying" || !job.targetId || !job.conversationId) throw new AIError("AI_INTERNAL_ERROR", "Generation job is not ready to apply.");
      const [page] = await transaction.select().from(pageNodes).where(and(eq(pageNodes.id, job.targetId), eq(pageNodes.projectId, job.projectId), eq(pageNodes.type, "page"), isNull(pageNodes.deletedAt))).for("update");
      if (!page) throw new AIError("AI_PAGE_STALE", "This page changed while Canvas was working. Try your request again using the latest version.");
      if (page.currentVersionId !== job.basePageVersionId) { observe.validationFailed("page", { projectId: job.projectId, jobId: job.id, entityId: page.id, reason: "AI_PAGE_STALE" }); throw new AIError("AI_PAGE_STALE", "This page changed while Canvas was working. Try your request again using the latest version."); }
      const [existing] = await transaction.select().from(pageVersions).where(eq(pageVersions.generationJobId, job.id)).limit(1);
      if (existing) return (await transaction.update(generationJobs).set({ status: "completed", progressStage: "Completed", resultPageVersionId: existing.id, finishedAt: new Date() }).where(eq(generationJobs.id, job.id)).returning())[0]!;
      const [latest] = await transaction.select({ versionNumber: pageVersions.versionNumber }).from(pageVersions).where(and(eq(pageVersions.projectId, job.projectId), eq(pageVersions.pageId, page.id))).orderBy(desc(pageVersions.versionNumber)).limit(1);
      // Usage rows and the activated Page Version are written together, so active page
      // state and active usage state can never disagree after a successful activation.
      const resolvedUsages = await this.reconcile(transaction, job.projectId, page.id, input.manifest.blockUsages);
      const manifest: GeneratedPageManifest = { ...input.manifest, blockUsages: resolvedUsages, ...(input.designPlan ? { designPlan: input.designPlan } : {}) };
      // The Change Set is written first so the immutable version can point at it.
      const versionId = randomUUID();
      const changeSet = await recordChangeSet(transaction, {
        projectId: job.projectId, actorUserId: job.actorUserId, operation: job.operation === "page_generate" ? "page_generate" : "page_modify",
        summary: `${page.name}: ${input.summary.headline}`, generationJobId: job.id,
        items: [{ entityType: "page", entityId: page.id, beforeVersionId: job.basePageVersionId, afterVersionId: versionId }],
      });
      const [version] = await transaction.insert(pageVersions).values({ id: versionId, changeSetId: changeSet.id, projectId: job.projectId, pageId: page.id, versionNumber: (latest?.versionNumber ?? 0) + 1, document: input.document, sourceFormat: "static_html", manifest, seoMetadata: { title: input.document.metadata?.title ?? page.pageTitle, description: input.document.metadata?.description ?? page.metaDescription }, changeSummary: input.summary, sourceHash: input.manifest.sourceHash, createdByUserId: job.actorUserId, generationJobId: job.id }).returning();
      if (!version) throw new AIError("AI_INTERNAL_ERROR", "Page version could not be created.");
      await transaction.update(pageNodes).set({ currentVersionId: version.id, updatedAt: new Date() }).where(eq(pageNodes.id, page.id));
      const [message] = await transaction.insert(aiMessages).values({ conversationId: job.conversationId, role: "assistant", content: summaryMessage(input.summary), metadata: { generationJobId: job.id, pageVersionId: version.id, summary: input.summary } }).returning();
      const [completed] = await transaction.update(generationJobs).set({ status: "completed", progressStage: "Completed", resultPageVersionId: version.id, resultChangeSetId: changeSet.id, resultMessageId: message?.id, provider: input.provider, providerModel: input.model, providerRequestId: input.providerRequestId, usageMetadata: input.usage, finishedAt: new Date() }).where(eq(generationJobs.id, job.id)).returning();
      await transaction.insert(auditEvents).values([{ projectId: job.projectId, userId: job.actorUserId, action: "page.version_created", entityType: "page_version", entityId: version.id, metadata: { pageId: page.id, versionNumber: version.versionNumber } }, { projectId: job.projectId, userId: job.actorUserId, action: "page.version_activated", entityType: "page_version", entityId: version.id, metadata: { pageId: page.id } }, { projectId: job.projectId, userId: job.actorUserId, action: "ai.page_generation_completed", entityType: "generation_job", entityId: job.id, metadata: { pageId: page.id, versionId: version.id } }]);
      if (!completed) throw new AIError("AI_INTERNAL_ERROR", "Generation job could not be completed."); return completed;
    });
  }
}
