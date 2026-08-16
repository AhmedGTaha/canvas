import { and, eq, isNull, sql as drizzleSql } from "drizzle-orm";
import { AIOrchestrationService } from "@/domain/ai/orchestration-service";
import { MAX_JOB_ATTEMPTS, claimGenerationJobById, type GenerationJobStatus } from "@/domain/ai/job-service";
import { finalizeQueuedFollowUp, promoteQueuedFollowUp } from "@/domain/ai-queue/service";
import { db, type Database } from "@/server/db/client";
import { generationJobs } from "@/server/db/schema";
import { observe } from "@/server/observability/events";
import { WATCHDOG_MAX_ROUNDS, dispatchGenerationJob, scheduleGenerationWatchdog } from "@/server/queue/generation-queue";

const TERMINAL: GenerationJobStatus[] = ["completed", "failed", "cancelled"];

/** Why a delivery did no work. Every value is an expected, safe outcome. */
export type GenerationSkipReason = "missing" | "terminal" | "in_flight" | "cancel_requested" | "attempts_exhausted";

export type GenerationExecutionResult =
  /** The job ran to a terminal state, or was re-queued for a later attempt. */
  | { outcome: "processed"; jobId: string; status: GenerationJobStatus }
  | { outcome: "requeued"; jobId: string; retryAfterSeconds: number }
  /** The job exists and is still due, but not yet: this delivery arrived early. */
  | { outcome: "deferred"; jobId: string; retryAfterSeconds: number }
  /** Nothing to do — the usual answer to a duplicate delivery. */
  | { outcome: "skipped"; jobId: string; reason: GenerationSkipReason };

export type GenerationExecutionDependencies = {
  database?: Database;
  /** Overridable so tests can drive the lifecycle without a provider. */
  process?: (jobId: string) => Promise<{ status: GenerationJobStatus } | null>;
};

function orchestrate(dependencies: GenerationExecutionDependencies) {
  const database = dependencies.database ?? db;
  return dependencies.process ?? ((jobId: string) => new AIOrchestrationService(database).process(jobId));
}

/**
 * Classifies a delivery that claimed nothing, so the caller can tell "already handled"
 * from "arrived too early" without guessing.
 */
async function classify(jobId: string, database: Database): Promise<GenerationExecutionResult> {
  const [job] = await database.select().from(generationJobs).where(eq(generationJobs.id, jobId)).limit(1);
  if (!job) return { outcome: "skipped", jobId, reason: "missing" };
  if (TERMINAL.includes(job.status)) return { outcome: "skipped", jobId, reason: "terminal" };
  if (job.cancelRequestedAt) return { outcome: "skipped", jobId, reason: "cancel_requested" };
  if (job.attemptCount >= MAX_JOB_ATTEMPTS) return { outcome: "skipped", jobId, reason: "attempts_exhausted" };
  if (job.status === "queued") {
    const waitMs = job.availableAt.getTime() - Date.now();
    // Still queued and due, yet the claim lost the race: another runner has it.
    if (waitMs <= 0) return { outcome: "skipped", jobId, reason: "in_flight" };
    return { outcome: "deferred", jobId, retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) };
  }
  // In flight. Either another runner holds a fresh claim, or the claim just went stale
  // and a concurrent delivery took it over first. Both are somebody else's job now; the
  // job's watchdog republishes it if that runner also disappears.
  return { outcome: "skipped", jobId, reason: "in_flight" };
}

/**
 * Runs one already-claimed generation job to its next resting state.
 *
 * Shared by the queue consumer and the development worker so generation is orchestrated
 * in exactly one place. Errors inside a job are already turned into job state by the
 * orchestration service; anything that escapes here (a database outage, for instance) is
 * deliberately allowed to propagate so the caller's retry can see it.
 */
export async function runClaimedGenerationJob(jobId: string, dependencies: GenerationExecutionDependencies = {}): Promise<GenerationExecutionResult> {
  const database = dependencies.database ?? db;
  const result = await orchestrate(dependencies)(jobId);
  const status = result?.status ?? null;

  if (status && TERMINAL.includes(status)) {
    await finalizeQueuedFollowUp(jobId, status, database);
    // The next follow-up for this target can only start once this job is finished.
    // Promotion creates an ordinary generation job, which publishes itself.
    await promoteQueuedFollowUp(database);
    return { outcome: "processed", jobId, status };
  }

  if (status === "queued") {
    // A retryable failure moved the job back to `queued` with a backoff. The queue does
    // not remember it, so the next attempt is published explicitly.
    const [job] = await database.select().from(generationJobs).where(eq(generationJobs.id, jobId)).limit(1);
    const retryAfterSeconds = Math.max(1, Math.ceil(((job?.availableAt.getTime() ?? Date.now()) - Date.now()) / 1000));
    if (job && job.attemptCount < MAX_JOB_ATTEMPTS) {
      await dispatchGenerationJob({ jobId, projectId: job.projectId, attempt: job.attemptCount, reason: "retry", delaySeconds: retryAfterSeconds });
    }
    observe.generationJob("retried", { jobId, projectId: job?.projectId ?? "", reason: job?.errorCode ?? undefined });
    return { outcome: "requeued", jobId, retryAfterSeconds };
  }

  return { outcome: "processed", jobId, status: status ?? "failed" };
}

/**
 * Claims and runs one generation job named by a queue delivery.
 *
 * Claiming first is what makes at-least-once delivery safe: a duplicate delivery for a
 * job that is running or finished claims nothing and reports `skipped`.
 */
export async function executeGenerationJob(jobId: string, options: { workerId: string } & GenerationExecutionDependencies): Promise<GenerationExecutionResult> {
  const database = options.database ?? db;
  const claimed = await claimGenerationJobById(jobId, options.workerId);
  if (!claimed) return classify(jobId, database);
  return runClaimedGenerationJob(jobId, options);
}

/** How long a claim is trusted before the job counts as abandoned. Matches the SQL guard
 *  in `claimGenerationJobById`, which is what actually enforces it. */
const STALE_CLAIM_MS = 5 * 60_000;
/** A queued job is only "stuck" once it is comfortably past its due time. */
const STUCK_QUEUED_GRACE_MS = 60_000;

/** What a watchdog concluded. Only `republished` changes anything. */
export type GenerationWatchdogVerdict =
  /** The job was owed work nobody was doing, so an execution was republished. */
  | "republished"
  /** Someone holds a fresh claim, or the job is not due yet. Checked again later. */
  | "healthy"
  /** Nothing left to do: finished, cancelled, out of attempts, or gone. */
  | "settled"
  /** The chain reached its bound. The daily maintenance sweep is the remaining net. */
  | "exhausted";

export type GenerationWatchdogResult = { jobId: string; round: number; verdict: GenerationWatchdogVerdict; reason?: GenerationSkipReason | "not_due" | "in_flight" };

/**
 * The delayed per-job self-check that replaces a frequent recovery cron.
 *
 * It runs no generation of its own — it reads the job row and, at most, republishes an
 * `execute` message, which still has to win the claim before anything happens. So a
 * watchdog for a job that completed, failed, was cancelled, or is actively claimed is a
 * pure no-op, and it can never execute the same generation twice.
 *
 * While the job is still unfinished the next round is armed, up to `WATCHDOG_MAX_ROUNDS`,
 * so a job that stays stuck is checked repeatedly without any scheduled infrastructure.
 */
export async function runGenerationWatchdog(jobId: string, round: number, database: Database = db): Promise<GenerationWatchdogResult> {
  const [job] = await database.select().from(generationJobs).where(eq(generationJobs.id, jobId)).limit(1);
  if (!job) return { jobId, round, verdict: "settled", reason: "missing" };
  if (TERMINAL.includes(job.status)) return { jobId, round, verdict: "settled", reason: "terminal" };
  if (job.cancelRequestedAt) return { jobId, round, verdict: "settled", reason: "cancel_requested" };
  // Out of attempts is a job for `MaintenanceService`, which fails it for the UI.
  if (job.attemptCount >= MAX_JOB_ATTEMPTS) return { jobId, round, verdict: "settled", reason: "attempts_exhausted" };

  const now = Date.now();
  const stuckQueued = job.status === "queued" && job.availableAt.getTime() <= now - STUCK_QUEUED_GRACE_MS;
  const abandoned = job.status !== "queued" && (job.claimedAt?.getTime() ?? 0) <= now - STALE_CLAIM_MS;

  if (stuckQueued || abandoned) {
    // A distinct salt per round: a job stuck across several checks is genuinely
    // republished rather than deduplicated against a message that never arrived.
    await dispatchGenerationJob({ jobId, projectId: job.projectId, attempt: job.attemptCount, reason: "recovery", dedupeSalt: `w${round}`, arm: false });
  }

  if (round < WATCHDOG_MAX_ROUNDS) await scheduleGenerationWatchdog({ jobId, projectId: job.projectId, attempt: job.attemptCount, round: round + 1 });
  if (stuckQueued || abandoned) return { jobId, round, verdict: "republished" };
  if (round >= WATCHDOG_MAX_ROUNDS) return { jobId, round, verdict: "exhausted" };
  return { jobId, round, verdict: "healthy", reason: job.status === "queued" ? "not_due" : "in_flight" };
}

/**
 * Republishes generation jobs the queue appears to have lost.
 *
 * Two cases: a job whose publish failed (or whose message expired) and is still sitting
 * `queued` past its due time, and a job whose runner died mid-flight leaving a stale
 * claim. Both are recoverable because the claim guards make a redundant message harmless.
 * Jobs out of attempts are left to `MaintenanceService`, which fails them for the UI.
 *
 * Per-job watchdogs already cover both cases within minutes; this batch sweep is the
 * last-resort net for the case they cannot cover — a job whose `execute` *and* whole
 * watchdog chain failed to publish, or one stuck longer than the chain lasts. It runs from
 * the once-daily maintenance cron, which is all a Hobby deployment allows.
 */
export async function recoverStalledGenerationJobs(database: Database = db) {
  const rows = await database
    .select({ id: generationJobs.id, projectId: generationJobs.projectId, attemptCount: generationJobs.attemptCount })
    .from(generationJobs)
    .where(and(
      drizzleSql`${generationJobs.attemptCount} < ${MAX_JOB_ATTEMPTS}`,
      isNull(generationJobs.cancelRequestedAt),
      drizzleSql`((${generationJobs.status} = 'queued' AND ${generationJobs.availableAt} <= now() - interval '1 minute')
        OR (${generationJobs.status} IN ('preparing_context', 'generating', 'validating', 'applying') AND ${generationJobs.claimedAt} < now() - interval '5 minutes'))`,
    ))
    .orderBy(generationJobs.availableAt, generationJobs.createdAt)
    .limit(50);

  // A time bucket keeps repeated sweeps of the same stuck job from deduplicating against
  // a message that never arrived, while still collapsing concurrent sweeps.
  const bucket = `r${Math.floor(Date.now() / 300_000)}`;
  let republished = 0;
  for (const row of rows) {
    const result = await dispatchGenerationJob({ jobId: row.id, projectId: row.projectId, attempt: row.attemptCount, reason: "recovery", dedupeSalt: bucket });
    if (result.published) republished += 1;
  }
  return { candidates: rows.length, republished };
}
