import { and, desc, eq, inArray, sql as drizzleSql } from "drizzle-orm";
import { db, sql, type Database } from "@/server/db/client";
import { aiConversations, aiJobRateLimits, aiMessages, auditEvents, buildingBlockVersions, buildingBlocks, generationJobMedia, generationJobs, mediaAssets, pageNodes, pageVersions } from "@/server/db/schema";
import { ProjectAccessService } from "@/server/permissions/project-access";
import { DomainError } from "@/domain/shared/errors";
import { AIError } from "./provider";
import { createBlockJobSchema } from "@/domain/blocks/schemas";
import { elementNotFound, findEditableElement, type ResolvedElementSelection } from "@/domain/generated-source/selection";
import { createAssistantJobSchema, createPageJobSchema } from "./schemas";
import { observe } from "@/server/observability/events";
import { dispatchGenerationJob } from "@/server/queue/generation-queue";
import { actorModelDescriptor } from "./connections/model-resolution";

/**
 * Provider identity recorded on a job row at creation, from the *actor's* current account
 * selection. It is a snapshot for display only — the worker resolves the actor's
 * selection again at execution time — and it never includes a credential. Someone with no
 * usable selection still gets a job row, which then fails with a clear configuration
 * error rather than borrowing anyone else's key.
 */
async function aiProviderRecord(database: Database, actorUserId: string) {
  const descriptor = await actorModelDescriptor(actorUserId, database);
  return { provider: descriptor?.provider ?? "unresolved", providerModel: descriptor?.model ?? null, aiConnectionId: descriptor?.connectionId ?? null };
}

export type GenerationJobStatus = typeof generationJobs.$inferSelect.status;
const TERMINAL: GenerationJobStatus[] = ["completed", "failed", "cancelled"];
export const JOB_TRANSITIONS: Record<GenerationJobStatus, GenerationJobStatus[]> = {
  queued: ["preparing_context", "cancelled"],
  preparing_context: ["generating", "failed", "cancelled", "queued"],
  generating: ["validating", "completed", "failed", "cancelled", "queued"],
  validating: ["applying", "failed", "cancelled"], applying: ["completed", "failed", "cancelled"],
  completed: [], failed: [], cancelled: [],
};

async function applyRateLimit(database: Database, scope: "user" | "project", subjectId: string, maximum: number) {
  const [row] = await database.insert(aiJobRateLimits).values({ scope, subjectId }).onConflictDoUpdate({
    target: [aiJobRateLimits.scope, aiJobRateLimits.subjectId],
    set: { attemptCount: drizzleSql`CASE WHEN ${aiJobRateLimits.windowStartedAt} < now() - interval '5 minutes' THEN 1 ELSE ${aiJobRateLimits.attemptCount} + 1 END`, windowStartedAt: drizzleSql`CASE WHEN ${aiJobRateLimits.windowStartedAt} < now() - interval '5 minutes' THEN now() ELSE ${aiJobRateLimits.windowStartedAt} END` },
  }).returning();
  if (row && row.attemptCount > maximum) throw new DomainError("RATE_LIMITED", "Too many AI requests. Try again in a few minutes.");
}

export class GenerationJobService {
  constructor(private readonly database: Database = db, private readonly access = new ProjectAccessService()) {}

  /**
   * Hands a committed job to the durable queue.
   *
   * Publishing happens after the transaction commits, so the consumer can never see a
   * message for a row that does not exist yet. Only the job id travels.
   */
  private async dispatch(job: typeof generationJobs.$inferSelect) {
    await dispatchGenerationJob({ jobId: job.id, projectId: job.projectId, attempt: job.attemptCount, reason: "created" });
    return job;
  }

  async createAssistantJob(userId: string, input: unknown) {
    const parsed = createAssistantJobSchema.parse(input);
    await this.access.requireProjectAccess(userId, parsed.projectId);
    const [conversation] = await this.database.select().from(aiConversations).where(and(eq(aiConversations.id, parsed.conversationId), eq(aiConversations.projectId, parsed.projectId))).limit(1);
    if (!conversation) throw new DomainError("NOT_FOUND", "Conversation not found.");
    await applyRateLimit(this.database, "user", userId, 10);
    await applyRateLimit(this.database, "project", parsed.projectId, 30);
    const providerRecord = await aiProviderRecord(this.database, userId);
    const created = await this.database.transaction(async (transaction) => {
      const [message] = await transaction.insert(aiMessages).values({ conversationId: conversation.id, role: "user", userId, content: parsed.content }).returning();
      if (!message) throw new Error("User message insert failed.");
      const targetType = conversation.pageId ? "page" as const : "project" as const;
      const [job] = await transaction.insert(generationJobs).values({ projectId: parsed.projectId, conversationId: conversation.id, actorUserId: userId, targetType, targetId: conversation.pageId, promptMessageId: message.id, ...providerRecord, contextMetadata: { selectedMediaIds: parsed.selectedMediaIds } }).returning();
      if (!job) throw new Error("Generation job insert failed.");
      await transaction.update(aiConversations).set({ updatedAt: new Date() }).where(eq(aiConversations.id, conversation.id));
      await transaction.insert(auditEvents).values({ projectId: parsed.projectId, userId, action: "ai.job_created", entityType: "generation_job", entityId: job.id });
      observe.generationJob("created", { jobId: job.id, projectId: parsed.projectId, operation: "assistant" });
      return { job, message };
    });
    await this.dispatch(created.job);
    return created;
  }

  async createPageJob(userId: string, input: unknown, queueItemId?: string) {
    const parsed = createPageJobSchema.parse(input);
    await this.access.requireProjectAccess(userId, parsed.projectId);
    await applyRateLimit(this.database, "user", userId, 10); await applyRateLimit(this.database, "project", parsed.projectId, 30);
    const providerRecord = await aiProviderRecord(this.database, userId);
    let created;
    try {
      created = await this.database.transaction(async (transaction) => {
        const [page] = await transaction.select().from(pageNodes).where(and(eq(pageNodes.id, parsed.pageId), eq(pageNodes.projectId, parsed.projectId), eq(pageNodes.type, "page"), drizzleSql`${pageNodes.deletedAt} IS NULL`)).for("update");
        if (!page) throw new DomainError("NOT_FOUND", "Page not found in this project.");
        const selectedIds = [...new Set(parsed.selectedMediaIds)];
        const selected = selectedIds.length ? await transaction.select({ id: mediaAssets.id }).from(mediaAssets).where(and(eq(mediaAssets.projectId, parsed.projectId), inArray(mediaAssets.id, selectedIds), drizzleSql`${mediaAssets.deletedAt} IS NULL`)) : [];
        if (selected.length !== selectedIds.length) throw new DomainError("NOT_FOUND", "One or more selected Media items are not active in this project.");
        // A selected element is only ever a lookup key: the real target is resolved from
        // the manifest of the version that is active right now.
        let selectedElement: ResolvedElementSelection | null = null;
        if (parsed.selection) {
          if (parsed.selection.blockId) throw new AIError("AI_ELEMENT_INVALID", "That element belongs to a shared Building Block. Canvas updates it from the Building Block instead.");
          if (!page.currentVersionId) elementNotFound();
          const [version] = await transaction.select().from(pageVersions).where(and(eq(pageVersions.id, page.currentVersionId), eq(pageVersions.pageId, page.id), eq(pageVersions.projectId, parsed.projectId))).limit(1);
          const element = version ? findEditableElement(version.manifest, parsed.selection.canvasId) : null;
          if (!element) elementNotFound();
          selectedElement = { ...element, ownerType: "page", ownerId: page.id };
        }
        let [conversation] = await transaction.select().from(aiConversations).where(and(eq(aiConversations.projectId, parsed.projectId), eq(aiConversations.pageId, parsed.pageId), drizzleSql`${aiConversations.archivedAt} IS NULL`)).orderBy(desc(aiConversations.updatedAt)).limit(1);
        if (!conversation) [conversation] = await transaction.insert(aiConversations).values({ projectId: parsed.projectId, pageId: parsed.pageId, createdByUserId: userId }).returning();
        if (!conversation) throw new Error("Page conversation insert failed.");
        const [message] = await transaction.insert(aiMessages).values({ conversationId: conversation.id, role: "user", userId, content: parsed.content, metadata: selectedElement ? { selectedElement } : null }).returning();
        if (!message) throw new Error("User message insert failed.");
        const operation = page.currentVersionId ? "page_modify" as const : "page_generate" as const;
        const [job] = await transaction.insert(generationJobs).values({ projectId: parsed.projectId, conversationId: conversation.id, actorUserId: userId, targetType: "page", targetId: page.id, operation, basePageVersionId: page.currentVersionId, promptMessageId: message.id, queueItemId, ...providerRecord, contextMetadata: selectedElement ? { selectedElement } : null }).returning();
        if (!job) throw new Error("Generation job insert failed.");
        if (selectedIds.length) await transaction.insert(generationJobMedia).values(selectedIds.map((mediaAssetId, position) => ({ generationJobId: job.id, projectId: parsed.projectId, mediaAssetId, position })));
        await transaction.update(aiConversations).set({ updatedAt: new Date() }).where(eq(aiConversations.id, conversation.id));
        await transaction.insert(auditEvents).values({ projectId: parsed.projectId, userId, action: "ai.page_generation_requested", entityType: "generation_job", entityId: job.id, metadata: { operation, pageId: page.id, mediaCount: selectedIds.length, selectedCanvasId: selectedElement?.canvasId ?? null } });
        observe.generationJob("created", { jobId: job.id, projectId: parsed.projectId, operation, targetId: page.id });
        return { job, message, conversation };
      });
    } catch (error) {
      const code = (error as { cause?: { code?: string }; code?: string }).cause?.code ?? (error as { code?: string }).code;
      if (code === "23505") throw new DomainError("CONFLICT", "Canvas is already updating this page.");
      throw error;
    }
    await this.dispatch(created.job);
    return created;
  }

  /**
   * Starts a Building Block generation/modification job. The block already has a durable
   * UUID, so retries and reconnects stay deterministic, and the partial unique index on
   * active block mutations enforces one AI job per block at the database level.
   */
  async createBlockJob(userId: string, input: unknown, queueItemId?: string) {
    const parsed = createBlockJobSchema.parse(input);
    await this.access.requireProjectAccess(userId, parsed.projectId);
    await applyRateLimit(this.database, "user", userId, 10); await applyRateLimit(this.database, "project", parsed.projectId, 30);
    const providerRecord = await aiProviderRecord(this.database, userId);
    let created;
    try {
      created = await this.database.transaction(async (transaction) => {
        const [block] = await transaction.select().from(buildingBlocks).where(and(eq(buildingBlocks.id, parsed.blockId), eq(buildingBlocks.projectId, parsed.projectId), drizzleSql`${buildingBlocks.deletedAt} IS NULL`)).for("update");
        if (!block) throw new DomainError("NOT_FOUND", "Building Block not found in this project.");
        const selectedIds = [...new Set(parsed.selectedMediaIds)];
        const selected = selectedIds.length ? await transaction.select({ id: mediaAssets.id }).from(mediaAssets).where(and(eq(mediaAssets.projectId, parsed.projectId), inArray(mediaAssets.id, selectedIds), drizzleSql`${mediaAssets.deletedAt} IS NULL`)) : [];
        if (selected.length !== selectedIds.length) throw new DomainError("NOT_FOUND", "One or more selected Media items are not active in this project.");
        let selectedElement: ResolvedElementSelection | null = null;
        if (parsed.selection) {
          if (parsed.selection.blockId && parsed.selection.blockId !== block.id) throw new AIError("AI_ELEMENT_INVALID", "That element belongs to a different Building Block.");
          if (!block.currentVersionId) elementNotFound();
          const [version] = await transaction.select().from(buildingBlockVersions).where(and(eq(buildingBlockVersions.id, block.currentVersionId), eq(buildingBlockVersions.buildingBlockId, block.id), eq(buildingBlockVersions.projectId, parsed.projectId))).limit(1);
          const element = version ? findEditableElement(version.manifest, parsed.selection.canvasId) : null;
          if (!element) elementNotFound();
          selectedElement = { ...element, ownerType: "building_block", ownerId: block.id };
        }
        let [conversation] = await transaction.select().from(aiConversations).where(and(eq(aiConversations.projectId, parsed.projectId), eq(aiConversations.buildingBlockId, parsed.blockId), drizzleSql`${aiConversations.archivedAt} IS NULL`)).orderBy(desc(aiConversations.updatedAt)).limit(1);
        if (!conversation) [conversation] = await transaction.insert(aiConversations).values({ projectId: parsed.projectId, buildingBlockId: parsed.blockId, createdByUserId: userId }).returning();
        if (!conversation) throw new Error("Block conversation insert failed.");
        const [message] = await transaction.insert(aiMessages).values({ conversationId: conversation.id, role: "user", userId, content: parsed.content, metadata: selectedElement ? { selectedElement } : null }).returning();
        if (!message) throw new Error("User message insert failed.");
        const operation = block.currentVersionId ? "block_modify" as const : "block_generate" as const;
        const [job] = await transaction.insert(generationJobs).values({ projectId: parsed.projectId, conversationId: conversation.id, actorUserId: userId, targetType: "building_block", targetId: block.id, operation, baseBlockVersionId: block.currentVersionId, promptMessageId: message.id, queueItemId, ...providerRecord, contextMetadata: selectedElement ? { selectedElement } : null }).returning();
        if (!job) throw new Error("Generation job insert failed.");
        if (selectedIds.length) await transaction.insert(generationJobMedia).values(selectedIds.map((mediaAssetId, position) => ({ generationJobId: job.id, projectId: parsed.projectId, mediaAssetId, position })));
        await transaction.update(aiConversations).set({ updatedAt: new Date() }).where(eq(aiConversations.id, conversation.id));
        await transaction.insert(auditEvents).values({ projectId: parsed.projectId, userId, action: "ai.block_generation_requested", entityType: "generation_job", entityId: job.id, metadata: { operation, blockId: block.id, mediaCount: selectedIds.length, selectedCanvasId: selectedElement?.canvasId ?? null } });
        observe.generationJob("created", { jobId: job.id, projectId: parsed.projectId, operation, targetId: block.id });
        return { job, message, conversation };
      });
    } catch (error) {
      const code = (error as { cause?: { code?: string }; code?: string }).cause?.code ?? (error as { code?: string }).code;
      if (code === "23505") throw new DomainError("CONFLICT", "Canvas is already updating this Building Block.");
      throw error;
    }
    await this.dispatch(created.job);
    return created;
  }

  /** Block-scoped composer state: conversation, recent messages, and the current job. */
  async getBlockState(userId: string, projectId: string, blockId: string) {
    await this.access.requireProjectAccess(userId, projectId);
    const [block] = await this.database.select({ id: buildingBlocks.id, currentVersionId: buildingBlocks.currentVersionId }).from(buildingBlocks).where(and(eq(buildingBlocks.id, blockId), eq(buildingBlocks.projectId, projectId), drizzleSql`${buildingBlocks.deletedAt} IS NULL`)).limit(1);
    if (!block) throw new DomainError("NOT_FOUND", "Building Block not found.");
    const [conversation] = await this.database.select().from(aiConversations).where(and(eq(aiConversations.projectId, projectId), eq(aiConversations.buildingBlockId, blockId), drizzleSql`${aiConversations.archivedAt} IS NULL`)).orderBy(desc(aiConversations.updatedAt)).limit(1);
    const messages = conversation ? (await this.database.select().from(aiMessages).where(and(eq(aiMessages.conversationId, conversation.id), inArray(aiMessages.role, ["user", "assistant"]))).orderBy(desc(aiMessages.createdAt)).limit(20)).reverse() : [];
    const [activeJob] = await this.database.select().from(generationJobs).where(and(eq(generationJobs.projectId, projectId), eq(generationJobs.targetId, blockId), inArray(generationJobs.operation, ["block_generate", "block_modify"]), inArray(generationJobs.status, ["queued", "preparing_context", "generating", "validating", "applying"]))).orderBy(desc(generationJobs.createdAt)).limit(1);
    const [latestJob] = activeJob ? [] : await this.database.select().from(generationJobs).where(and(eq(generationJobs.projectId, projectId), eq(generationJobs.targetId, blockId), inArray(generationJobs.operation, ["block_generate", "block_modify"]))).orderBy(desc(generationJobs.createdAt)).limit(1);
    return { block, conversation: conversation ?? null, messages, job: activeJob ?? latestJob ?? null };
  }

  async get(userId: string, projectId: string, jobId: string) {
    await this.access.requireProjectAccess(userId, projectId);
    const [job] = await this.database.select().from(generationJobs).where(and(eq(generationJobs.id, jobId), eq(generationJobs.projectId, projectId))).limit(1);
    if (!job) throw new DomainError("NOT_FOUND", "Generation job not found.");
    return job;
  }

  async list(userId: string, projectId: string) { await this.access.requireProjectAccess(userId, projectId); return this.database.select().from(generationJobs).where(eq(generationJobs.projectId, projectId)).orderBy(desc(generationJobs.createdAt)).limit(50); }

  async getPageState(userId: string, projectId: string, pageId: string) {
    await this.access.requireProjectAccess(userId, projectId);
    const [page] = await this.database.select({ id: pageNodes.id, currentVersionId: pageNodes.currentVersionId }).from(pageNodes).where(and(eq(pageNodes.id, pageId), eq(pageNodes.projectId, projectId), eq(pageNodes.type, "page"), drizzleSql`${pageNodes.deletedAt} IS NULL`)).limit(1);
    if (!page) throw new DomainError("NOT_FOUND", "Page not found.");
    const [conversation] = await this.database.select().from(aiConversations).where(and(eq(aiConversations.projectId, projectId), eq(aiConversations.pageId, pageId), drizzleSql`${aiConversations.archivedAt} IS NULL`)).orderBy(desc(aiConversations.updatedAt)).limit(1);
    const messages = conversation ? (await this.database.select().from(aiMessages).where(and(eq(aiMessages.conversationId, conversation.id), inArray(aiMessages.role, ["user", "assistant"]))).orderBy(desc(aiMessages.createdAt)).limit(20)).reverse() : [];
    const [activeJob] = await this.database.select().from(generationJobs).where(and(eq(generationJobs.projectId, projectId), eq(generationJobs.targetId, pageId), inArray(generationJobs.operation, ["page_generate", "page_modify"]), inArray(generationJobs.status, ["queued", "preparing_context", "generating", "validating", "applying"]))).orderBy(desc(generationJobs.createdAt)).limit(1);
    const [latestJob] = activeJob ? [] : await this.database.select().from(generationJobs).where(and(eq(generationJobs.projectId, projectId), eq(generationJobs.targetId, pageId), inArray(generationJobs.operation, ["page_generate", "page_modify"]))).orderBy(desc(generationJobs.createdAt)).limit(1);
    return { page, conversation: conversation ?? null, messages, job: activeJob ?? latestJob ?? null };
  }

  async requestCancellation(userId: string, projectId: string, jobId: string) {
    const job = await this.get(userId, projectId, jobId);
    if (TERMINAL.includes(job.status)) throw new DomainError("CONFLICT", "This job has already finished.");
    const now = new Date();
    const patch = job.status === "queued" ? { cancelRequestedAt: now, status: "cancelled" as const, progressStage: "Cancelled", finishedAt: now } : { cancelRequestedAt: now };
    const [updated] = await this.database.update(generationJobs).set(patch).where(and(eq(generationJobs.id, jobId), eq(generationJobs.projectId, projectId), inArray(generationJobs.status, ["queued", "preparing_context", "generating", "validating", "applying"]))).returning();
    if (!updated) throw new DomainError("CONFLICT", "This job has already finished.");
    await this.database.insert(auditEvents).values({ projectId, userId, action: "ai.job_cancel_requested", entityType: "generation_job", entityId: jobId });
    // Cancelling a queued job settles it here, so nothing else will promote the next
    // follow-up for this target. A mid-flight cancellation is finalized by the runner,
    // which promotes there. Kept out of the transaction: promotion creates its own job.
    // Imported here because the follow-up queue creates jobs through this service.
    if (updated.status === "cancelled") await (await import("@/domain/ai-queue/service")).promoteQueuedFollowUp(this.database);
    return updated;
  }
}

export class GenerationJobLifecycle {
  constructor(private readonly database: Database = db) {}
  async transition(jobId: string, next: GenerationJobStatus, progressStage: string, patch: Partial<typeof generationJobs.$inferInsert> = {}) {
    return this.database.transaction(async (transaction) => {
      const [current] = await transaction.select().from(generationJobs).where(eq(generationJobs.id, jobId)).for("update");
      if (!current) throw new DomainError("NOT_FOUND", "Generation job not found.");
      if (!JOB_TRANSITIONS[current.status].includes(next)) throw new DomainError("CONFLICT", `Invalid generation job transition: ${current.status} to ${next}.`);
      const terminal = TERMINAL.includes(next);
      const [updated] = await transaction.update(generationJobs).set({ ...patch, status: next, progressStage, startedAt: current.startedAt ?? (next === "preparing_context" ? new Date() : null), finishedAt: terminal ? new Date() : null }).where(and(eq(generationJobs.id, jobId), eq(generationJobs.status, current.status))).returning();
      if (!updated) throw new DomainError("CONFLICT", "Generation job changed concurrently.");
      return updated;
    });
  }
}

export const MAX_JOB_ATTEMPTS = 3;
/** How long a claim is trusted before another runner may take the job over. */
export const STALE_CLAIM_INTERVAL = "5 minutes";

export async function claimGenerationJob(workerId: string) {
  const rows = await sql<{ id: string }[]>`
    UPDATE generation_jobs SET status = 'preparing_context', progress_stage = 'Preparing project context', claimed_at = now(),
      worker_id = ${workerId}, attempt_count = attempt_count + 1, started_at = COALESCE(started_at, now())
    WHERE id = (SELECT id FROM generation_jobs
      WHERE ((status = 'queued' AND available_at <= now()) OR (status IN ('preparing_context', 'generating', 'validating', 'applying') AND claimed_at < now() - interval '5 minutes'))
        AND attempt_count < 3 AND cancel_requested_at IS NULL
      ORDER BY available_at, created_at FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING id`;
  if (!rows[0]) return null;
  const [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, rows[0].id)).limit(1);
  return job ?? null;
}

/**
 * Claims one specific generation job, for a queue delivery that names it.
 *
 * This is the idempotency boundary for at-least-once delivery: the same guards as the
 * polling claim — due, not cancelled, inside the attempt budget, and either unclaimed or
 * claimed long enough ago to count as abandoned — expressed as a single conditional
 * UPDATE. A duplicate delivery of a job that is already running, already finished, or not
 * yet due simply claims nothing and returns null.
 */
export async function claimGenerationJobById(jobId: string, workerId: string) {
  const rows = await sql<{ id: string }[]>`
    UPDATE generation_jobs SET status = 'preparing_context', progress_stage = 'Preparing project context', claimed_at = now(),
      worker_id = ${workerId}, attempt_count = attempt_count + 1, started_at = COALESCE(started_at, now())
    WHERE id = (SELECT id FROM generation_jobs
      WHERE id = ${jobId}
        AND ((status = 'queued' AND available_at <= now()) OR (status IN ('preparing_context', 'generating', 'validating', 'applying') AND claimed_at < now() - interval '5 minutes'))
        AND attempt_count < 3 AND cancel_requested_at IS NULL
      FOR UPDATE SKIP LOCKED)
    RETURNING id`;
  if (!rows[0]) return null;
  const [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, jobId)).limit(1);
  return job ?? null;
}

export function safeAIError(error: unknown) {
  if (error instanceof AIError) return error;
  return new AIError(
    "AI_INTERNAL_ERROR",
    "Canvas could not complete this AI request.",
    false,
    undefined,
    error instanceof Error ? error.message : String(error),
  );
}
