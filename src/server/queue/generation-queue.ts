import { DuplicateMessageError, send } from "@vercel/queue";
import { z } from "zod";
import { observe } from "@/server/observability/events";

/**
 * Vercel Queues transport for AI generation work.
 *
 * The queue carries a pointer, never a payload: a message is a generation job id plus a
 * one-word message type. Everything the consumer needs — prompt, project, actor, provider
 * selection, encrypted credentials, media, cancellation — is read back from
 * `generation_jobs` and its related rows, which stay the durable source of truth. No
 * credential, prompt text, or user content ever enters a queue message.
 *
 * Two message types travel on the topic:
 *
 * - `execute` asks the consumer to claim and run the job.
 * - `watchdog` is a delayed self-check. It runs no generation; it looks at the job row and
 *   republishes an `execute` only if the job is still owed work. This is what replaces a
 *   frequent recovery cron: recovery rides on the queue itself, per job, so a Hobby
 *   deployment (where cron may only run once a day) still recovers within minutes.
 */
export const GENERATION_JOB_TOPIC = "canvas-generation-jobs";

/** How long after a dispatch the job is checked again. Just past the 300s function limit. */
export const WATCHDOG_DELAY_SECONDS = 300;
/** Bounded chain length, so a permanently stuck job cannot schedule itself forever. */
export const WATCHDOG_MAX_ROUNDS = 6;

export const generationJobMessageSchema = z.object({
  jobId: z.uuid(),
  /** Defaults to `execute` so a message published by an older deployment still runs. */
  type: z.enum(["execute", "watchdog"]).default("execute"),
  /** Watchdog only: which check in the chain this is, 1-based. */
  round: z.number().int().min(1).max(WATCHDOG_MAX_ROUNDS).optional(),
});
export type GenerationJobMessage = z.infer<typeof generationJobMessageSchema>;

export type GenerationDispatchMode = "queue" | "worker";

/** Why a job is being published. Recorded in telemetry so dispatch is traceable. */
export type GenerationDispatchReason = "created" | "retry" | "recovery" | "watchdog";

export type GenerationDispatchResult =
  | { mode: "worker"; published: false }
  | { mode: "queue"; published: true; messageId: string | null; duplicate: boolean }
  | { mode: "queue"; published: false; reason: string };

/**
 * Where newly created generation jobs are sent.
 *
 * On Vercel this is always the queue: production must never depend on a long-lived
 * `npm run worker` process. Locally the default is `worker`, so `npm run worker` keeps
 * working without a linked Vercel project; set `CANVAS_GENERATION_DISPATCH=queue` to
 * exercise the real queue path in development (`vercel link && vercel env pull` first).
 */
export function generationDispatchMode(): GenerationDispatchMode {
  const configured = process.env.CANVAS_GENERATION_DISPATCH;
  if (configured === "queue" || configured === "worker") return configured;
  return process.env.VERCEL ? "queue" : "worker";
}

export type GenerationQueueTransport = (input: {
  message: GenerationJobMessage;
  idempotencyKey: string;
  delaySeconds: number;
}) => Promise<{ messageId: string | null }>;

const vercelTransport: GenerationQueueTransport = async ({ message, idempotencyKey, delaySeconds }) =>
  send<GenerationJobMessage>(GENERATION_JOB_TOPIC, message, { idempotencyKey, ...(delaySeconds > 0 ? { delaySeconds } : {}) });

let transport: GenerationQueueTransport = vercelTransport;

/** Test seam. Production code always uses the `@vercel/queue` transport. */
export function setGenerationQueueTransport(next: GenerationQueueTransport | null) {
  transport = next ?? vercelTransport;
}

/**
 * Publishes one generation message.
 *
 * The idempotency key is scoped to the job *and its attempt*, so a duplicated publish of
 * the same attempt is deduplicated by the queue while a genuine retry of the same job is
 * a new message. Delivery is still at-least-once — the consumer claims the job row before
 * doing any work, which is what actually makes duplicate delivery safe.
 */
export async function publishGenerationJob(input: {
  jobId: string;
  attempt: number;
  reason: GenerationDispatchReason;
  delaySeconds?: number;
  /** Extra key material. Recovery and watchdogs pass a discriminator so a job stuck across
   *  checks is republished rather than silently deduplicated against a message that was
   *  lost. */
  dedupeSalt?: string;
  message?: GenerationJobMessage;
}): Promise<GenerationDispatchResult> {
  if (generationDispatchMode() === "worker") return { mode: "worker", published: false };
  const delaySeconds = Math.max(0, Math.ceil(input.delaySeconds ?? 0));
  const idempotencyKey = input.dedupeSalt ? `${input.jobId}:${input.attempt}:${input.dedupeSalt}` : `${input.jobId}:${input.attempt}`;
  const message = input.message ?? { jobId: input.jobId, type: "execute" as const };
  try {
    const { messageId } = await transport({ message, idempotencyKey, delaySeconds });
    return { mode: "queue", published: true, messageId, duplicate: false };
  } catch (error) {
    // A key collision means this attempt is already on the queue: the desired state.
    if (error instanceof DuplicateMessageError) return { mode: "queue", published: true, messageId: null, duplicate: true };
    throw error;
  }
}

/**
 * Schedules the delayed self-check for a job.
 *
 * This is the whole reason normal generation needs no frequent cron. Every dispatch arms
 * one, and each watchdog arms the next while the job is still unfinished, so a lost
 * message, a failed initial publish, or a runner that died mid-flight is noticed about
 * five minutes later without any scheduled infrastructure.
 */
export async function scheduleGenerationWatchdog(input: {
  jobId: string;
  projectId: string;
  /** The job's attempt count. Keeps each attempt's checks on their own dedupe keys. */
  attempt: number;
  round: number;
  delaySeconds?: number;
}): Promise<GenerationDispatchResult> {
  if (input.round > WATCHDOG_MAX_ROUNDS) return { mode: "queue", published: false, reason: "watchdog_rounds_exhausted" };
  try {
    const result = await publishGenerationJob({
      jobId: input.jobId,
      attempt: input.attempt,
      reason: "watchdog",
      delaySeconds: input.delaySeconds ?? WATCHDOG_DELAY_SECONDS,
      dedupeSalt: `watchdog:${input.round}`,
      message: { jobId: input.jobId, type: "watchdog", round: input.round },
    });
    if (result.mode === "worker") observe.generationDispatch("skipped", { jobId: input.jobId, projectId: input.projectId, mode: "worker", reason: "watchdog", round: input.round });
    else observe.generationDispatch("published", { jobId: input.jobId, projectId: input.projectId, mode: "queue", reason: "watchdog", attempt: input.attempt, round: input.round, duplicate: result.published ? result.duplicate : undefined });
    return result;
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    observe.generationDispatch("failed", { jobId: input.jobId, projectId: input.projectId, mode: "queue", reason: "watchdog", attempt: input.attempt, round: input.round, error: reason });
    return { mode: "queue", published: false, reason };
  }
}

/**
 * Publishes a job and reports the outcome instead of failing the caller.
 *
 * A publish failure is never hidden: the exact error code is emitted, and because the job
 * row is already committed, the watchdog armed alongside it republishes the job a few
 * minutes later. Failing the API request instead would leave the user with an error for
 * work that is in fact queued.
 *
 * The watchdog is armed even when the `execute` publish failed — that is exactly the case
 * it exists to repair — and independently, so one failure cannot swallow the other.
 */
export async function dispatchGenerationJob(input: {
  jobId: string;
  projectId: string;
  attempt: number;
  reason: GenerationDispatchReason;
  delaySeconds?: number;
  dedupeSalt?: string;
  /** Watchdog-driven republishes arm their own next round, so they pass `false`. */
  arm?: boolean;
  /** Round to arm. Defaults to the first check of a fresh chain. */
  watchdogRound?: number;
}): Promise<GenerationDispatchResult> {
  let result: GenerationDispatchResult;
  try {
    result = await publishGenerationJob(input);
    if (result.mode === "worker") observe.generationDispatch("skipped", { jobId: input.jobId, projectId: input.projectId, mode: "worker", reason: input.reason });
    else observe.generationDispatch("published", { jobId: input.jobId, projectId: input.projectId, mode: "queue", reason: input.reason, attempt: input.attempt, duplicate: result.published ? result.duplicate : undefined });
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    observe.generationDispatch("failed", { jobId: input.jobId, projectId: input.projectId, mode: "queue", reason: input.reason, attempt: input.attempt, error: reason });
    result = { mode: "queue", published: false, reason };
  }

  if (input.arm !== false && result.mode === "queue") {
    const delaySeconds = Math.max(WATCHDOG_DELAY_SECONDS, Math.ceil(input.delaySeconds ?? 0) + WATCHDOG_DELAY_SECONDS);
    await scheduleGenerationWatchdog({ jobId: input.jobId, projectId: input.projectId, attempt: input.attempt, round: input.watchdogRound ?? 1, delaySeconds });
  }
  return result;
}
