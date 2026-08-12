import { and, desc, eq, inArray, sql as drizzleSql } from "drizzle-orm";
import { db, sql, type Database } from "@/server/db/client";
import { aiConversations, aiJobRateLimits, aiMessages, auditEvents, generationJobs } from "@/server/db/schema";
import { ProjectAccessService } from "@/server/permissions/project-access";
import { DomainError } from "@/domain/shared/errors";
import { AIError } from "./provider";
import { createAssistantJobSchema } from "./schemas";

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

  async createAssistantJob(userId: string, input: unknown) {
    const parsed = createAssistantJobSchema.parse(input);
    await this.access.requireProjectAccess(userId, parsed.projectId);
    const [conversation] = await this.database.select().from(aiConversations).where(and(eq(aiConversations.id, parsed.conversationId), eq(aiConversations.projectId, parsed.projectId))).limit(1);
    if (!conversation) throw new DomainError("NOT_FOUND", "Conversation not found.");
    await applyRateLimit(this.database, "user", userId, 10);
    await applyRateLimit(this.database, "project", parsed.projectId, 30);
    return this.database.transaction(async (transaction) => {
      const [message] = await transaction.insert(aiMessages).values({ conversationId: conversation.id, role: "user", userId, content: parsed.content }).returning();
      if (!message) throw new Error("User message insert failed.");
      const targetType = conversation.pageId ? "page" as const : "project" as const;
      const [job] = await transaction.insert(generationJobs).values({ projectId: parsed.projectId, conversationId: conversation.id, actorUserId: userId, targetType, targetId: conversation.pageId, promptMessageId: message.id, provider: (process.env.AI_PROVIDER ?? "gemini").toLowerCase(), providerModel: process.env.AI_MODEL || "gemini-2.5-flash", contextMetadata: { selectedMediaIds: parsed.selectedMediaIds } }).returning();
      if (!job) throw new Error("Generation job insert failed.");
      await transaction.update(aiConversations).set({ updatedAt: new Date() }).where(eq(aiConversations.id, conversation.id));
      await transaction.insert(auditEvents).values({ projectId: parsed.projectId, userId, action: "ai.job_created", entityType: "generation_job", entityId: job.id });
      console.info(JSON.stringify({ event: "ai.job.created", jobId: job.id, projectId: parsed.projectId }));
      return { job, message };
    });
  }

  async get(userId: string, projectId: string, jobId: string) {
    await this.access.requireProjectAccess(userId, projectId);
    const [job] = await this.database.select().from(generationJobs).where(and(eq(generationJobs.id, jobId), eq(generationJobs.projectId, projectId))).limit(1);
    if (!job) throw new DomainError("NOT_FOUND", "Generation job not found.");
    return job;
  }

  async list(userId: string, projectId: string) { await this.access.requireProjectAccess(userId, projectId); return this.database.select().from(generationJobs).where(eq(generationJobs.projectId, projectId)).orderBy(desc(generationJobs.createdAt)).limit(50); }

  async requestCancellation(userId: string, projectId: string, jobId: string) {
    const job = await this.get(userId, projectId, jobId);
    if (TERMINAL.includes(job.status)) throw new DomainError("CONFLICT", "This job has already finished.");
    const now = new Date();
    const patch = job.status === "queued" ? { cancelRequestedAt: now, status: "cancelled" as const, progressStage: "Cancelled", finishedAt: now } : { cancelRequestedAt: now };
    const [updated] = await this.database.update(generationJobs).set(patch).where(and(eq(generationJobs.id, jobId), eq(generationJobs.projectId, projectId), inArray(generationJobs.status, ["queued", "preparing_context", "generating", "validating", "applying"]))).returning();
    if (!updated) throw new DomainError("CONFLICT", "This job has already finished.");
    await this.database.insert(auditEvents).values({ projectId, userId, action: "ai.job_cancel_requested", entityType: "generation_job", entityId: jobId });
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

export async function claimGenerationJob(workerId: string) {
  const rows = await sql<{ id: string }[]>`
    UPDATE generation_jobs SET status = 'preparing_context', progress_stage = 'Preparing project context', claimed_at = now(),
      worker_id = ${workerId}, attempt_count = attempt_count + 1, started_at = COALESCE(started_at, now())
    WHERE id = (SELECT id FROM generation_jobs
      WHERE ((status = 'queued' AND available_at <= now()) OR (status IN ('preparing_context', 'generating') AND claimed_at < now() - interval '5 minutes'))
        AND attempt_count < 3 AND cancel_requested_at IS NULL
      ORDER BY available_at, created_at FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING id`;
  if (!rows[0]) return null;
  const [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, rows[0].id)).limit(1);
  return job ?? null;
}

export function safeAIError(error: unknown) {
  if (error instanceof AIError) return error;
  return new AIError("AI_INTERNAL_ERROR", "Canvas could not complete this AI request.");
}
