import { and, eq, inArray, sql as drizzleSql } from "drizzle-orm";
import { ExportService, MAX_EXPORT_ATTEMPTS, claimExportJobById } from "@/domain/export/export-service";
import { db, type Database } from "@/server/db/client";
import { auditEvents, exportJobs } from "@/server/db/schema";
import { observe } from "@/server/observability/events";
import { EXPORT_WATCHDOG_MAX_ROUNDS, dispatchExportJob, scheduleExportWatchdog } from "@/server/queue/export-queue";

const ACTIVE = ["queued", "validating", "assembling", "building", "packaging"] as const;
const TERMINAL = ["completed", "failed"] as const;
const STALE_CLAIM_MS = 5 * 60_000;
const STUCK_QUEUED_GRACE_MS = 60_000;
const RETRY_DELAY_SECONDS = 30;

export type ExportSkipReason = "missing" | "terminal" | "in_flight" | "attempts_exhausted";
export type ExportExecutionResult =
  | { outcome: "processed"; jobId: string; status: "completed" | "failed" }
  | { outcome: "requeued"; jobId: string; retryAfterSeconds: number }
  | { outcome: "deferred"; jobId: string; retryAfterSeconds: number }
  | { outcome: "skipped"; jobId: string; reason: ExportSkipReason };

async function classify(jobId: string, database: Database): Promise<ExportExecutionResult> {
  const [job] = await database.select().from(exportJobs).where(eq(exportJobs.id, jobId)).limit(1);
  if (!job) return { outcome: "skipped", jobId, reason: "missing" };
  if ((TERMINAL as readonly string[]).includes(job.status)) return { outcome: "skipped", jobId, reason: "terminal" };
  if (job.attemptCount >= MAX_EXPORT_ATTEMPTS) return { outcome: "skipped", jobId, reason: "attempts_exhausted" };
  if (job.status === "queued") {
    const waitMs = job.availableAt.getTime() - Date.now();
    return waitMs > 0 ? { outcome: "deferred", jobId, retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1_000)) } : { outcome: "skipped", jobId, reason: "in_flight" };
  }
  return { outcome: "skipped", jobId, reason: "in_flight" };
}

async function retryUnexpectedFailure(jobId: string, database: Database): Promise<ExportExecutionResult> {
  const [job] = await database.select().from(exportJobs).where(eq(exportJobs.id, jobId)).limit(1);
  if (!job) return { outcome: "skipped", jobId, reason: "missing" };
  if (job.attemptCount >= MAX_EXPORT_ATTEMPTS) {
    const [failed] = await database.update(exportJobs).set({ status: "failed", progressStage: "Failed", errorCode: "EXPORT_FAILED", errorMessage: "Canvas could not export this website. Try again.", finishedAt: new Date() })
      .where(and(eq(exportJobs.id, jobId), inArray(exportJobs.status, ACTIVE))).returning();
    if (failed) {
      await database.insert(auditEvents).values({ projectId: failed.projectId, userId: failed.actorUserId, action: "export.failed", entityType: "export_job", entityId: jobId, metadata: { errorCode: "EXPORT_FAILED" } });
      observe.exportJob("failed", { exportId: jobId, projectId: failed.projectId, reason: "EXPORT_FAILED" });
      return { outcome: "processed", jobId, status: "failed" };
    }
    return classify(jobId, database);
  }

  const availableAt = new Date(Date.now() + RETRY_DELAY_SECONDS * 1_000);
  const [queued] = await database.update(exportJobs).set({ status: "queued", progressStage: "Queued for retry", availableAt, claimedAt: null, workerId: null })
    .where(and(eq(exportJobs.id, jobId), inArray(exportJobs.status, ACTIVE))).returning();
  if (!queued) return classify(jobId, database);
  await dispatchExportJob({ jobId, projectId: queued.projectId, attempt: queued.attemptCount, reason: "retry", delaySeconds: RETRY_DELAY_SECONDS });
  observe.exportDelivery("requeued", { jobId, projectId: queued.projectId, retryAfterSeconds: RETRY_DELAY_SECONDS });
  return { outcome: "requeued", jobId, retryAfterSeconds: RETRY_DELAY_SECONDS };
}

/** Runs an already-claimed job. Both the queue consumer and local worker use this path. */
export async function runClaimedExportJob(jobId: string, database: Database = db): Promise<ExportExecutionResult> {
  try {
    const result = await new ExportService(database).process(jobId, { rethrowUnexpected: true });
    return { outcome: "processed", jobId, status: result?.status === "completed" ? "completed" : "failed" };
  } catch {
    return retryUnexpectedFailure(jobId, database);
  }
}

/** Queue execution: conditionally claim first so at-least-once deliveries are harmless. */
export async function executeExportJob(jobId: string, options: { workerId: string; database?: Database } ): Promise<ExportExecutionResult> {
  const database = options.database ?? db;
  const claimed = await claimExportJobById(jobId, options.workerId, database);
  if (!claimed) return classify(jobId, database);
  return runClaimedExportJob(jobId, database);
}

export type ExportWatchdogResult = { jobId: string; round: number; verdict: "republished" | "healthy" | "settled" | "exhausted"; reason?: ExportSkipReason | "not_due" };

/** Delayed, bounded recovery net for lost publishes and dead function instances. */
export async function runExportWatchdog(jobId: string, round: number, database: Database = db): Promise<ExportWatchdogResult> {
  const [job] = await database.select().from(exportJobs).where(eq(exportJobs.id, jobId)).limit(1);
  if (!job) return { jobId, round, verdict: "settled", reason: "missing" };
  if ((TERMINAL as readonly string[]).includes(job.status)) return { jobId, round, verdict: "settled", reason: "terminal" };
  if (job.attemptCount >= MAX_EXPORT_ATTEMPTS) return { jobId, round, verdict: "settled", reason: "attempts_exhausted" };
  const now = Date.now();
  const stuckQueued = job.status === "queued" && job.availableAt.getTime() <= now - STUCK_QUEUED_GRACE_MS;
  const abandoned = job.status !== "queued" && (job.claimedAt?.getTime() ?? 0) <= now - STALE_CLAIM_MS;
  if (stuckQueued || abandoned) await dispatchExportJob({ jobId, projectId: job.projectId, attempt: job.attemptCount, reason: "recovery", dedupeSalt: `w${round}`, arm: false });
  if (round < EXPORT_WATCHDOG_MAX_ROUNDS) await scheduleExportWatchdog({ jobId, projectId: job.projectId, attempt: job.attemptCount, round: round + 1 });
  if (stuckQueued || abandoned) return { jobId, round, verdict: "republished" };
  if (round >= EXPORT_WATCHDOG_MAX_ROUNDS) return { jobId, round, verdict: "exhausted" };
  return { jobId, round, verdict: "healthy", reason: job.status === "queued" ? "not_due" : "in_flight" };
}

/** Daily last-resort sweep when an entire watchdog chain could not be published. */
export async function recoverStalledExportJobs(database: Database = db) {
  const rows = await database.select({ id: exportJobs.id, projectId: exportJobs.projectId, attemptCount: exportJobs.attemptCount }).from(exportJobs)
    .where(and(drizzleSql`${exportJobs.attemptCount} < ${MAX_EXPORT_ATTEMPTS}`, drizzleSql`((${exportJobs.status} = 'queued' AND ${exportJobs.availableAt} <= now() - interval '1 minute') OR (${exportJobs.status} IN ('validating', 'assembling', 'building', 'packaging') AND ${exportJobs.claimedAt} < now() - interval '5 minutes'))`))
    .orderBy(exportJobs.availableAt, exportJobs.createdAt).limit(50);
  const bucket = `r${Math.floor(Date.now() / 300_000)}`;
  let republished = 0;
  for (const row of rows) if ((await dispatchExportJob({ jobId: row.id, projectId: row.projectId, attempt: row.attemptCount, reason: "recovery", dedupeSalt: bucket })).mode === "queue") republished += 1;
  return { candidates: rows.length, republished };
}
