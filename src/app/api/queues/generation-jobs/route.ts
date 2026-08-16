import { handleCallback } from "@vercel/queue";
import { executeGenerationJob, runGenerationWatchdog } from "@/server/jobs/generation-execution";
import { observe } from "@/server/observability/events";
import { generationJobMessageSchema } from "@/server/queue/generation-queue";

/**
 * Vercel Queues push consumer for AI generation.
 *
 * This route has no public URL: `experimentalTriggers` in vercel.json makes it callable
 * only by the queue infrastructure. It owns no generation logic — it validates the
 * pointer it was handed, then calls the same execution path the development worker uses.
 *
 * Delivery is at-least-once, so every duplicate is expected: `executeGenerationJob`
 * claims the job row first and reports `skipped` when there is nothing to do.
 *
 * Two message types arrive here. `execute` runs a job. `watchdog` is a delayed self-check
 * that runs no generation at all: it republishes an execution only when the job is still
 * owed work, which is how recovery happens without a frequent cron.
 *
 * 300s is the maximum a Hobby function may run (fluid compute, Node.js runtime), and the
 * default on every plan. A delivery cut short at that limit is not lost: the lease expires
 * and the message is redelivered, and the stale-claim guard lets the next delivery take
 * the job over.
 */
export const maxDuration = 300;

/** Signals a delivery that arrived before the job's backoff elapsed. */
class GenerationJobNotReady extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("Generation job is not due yet.");
    this.name = "GenerationJobNotReady";
  }
}

export const POST = handleCallback(
  async (message, metadata) => {
    const parsed = generationJobMessageSchema.parse(message);

    if (parsed.type === "watchdog") {
      const check = await runGenerationWatchdog(parsed.jobId, parsed.round ?? 1);
      observe.generationDelivery("watchdog", { jobId: parsed.jobId, deliveryCount: metadata.deliveryCount, round: check.round, verdict: check.verdict, reason: check.reason });
      return;
    }

    const result = await executeGenerationJob(parsed.jobId, { workerId: `queue:${metadata.messageId}`.slice(0, 120) });
    observe.generationDelivery(result.outcome, {
      jobId: parsed.jobId,
      deliveryCount: metadata.deliveryCount,
      reason: result.outcome === "skipped" ? result.reason : undefined,
      status: result.outcome === "processed" ? result.status : undefined,
      retryAfterSeconds: result.outcome === "requeued" || result.outcome === "deferred" ? result.retryAfterSeconds : undefined,
    });
    // A re-queued job is republished with its own backoff, so this message is done.
    if (result.outcome === "deferred") throw new GenerationJobNotReady(result.retryAfterSeconds);
  },
  {
    retry: (error, metadata) => {
      if (error instanceof GenerationJobNotReady) return { afterSeconds: error.retryAfterSeconds };
      // An unexpected failure here means the job never got claimed or the runtime died
      // mid-flight. Back off a few times, then let the job's watchdog take over rather
      // than redelivering the same message forever.
      if (metadata.deliveryCount >= 5) return { acknowledge: true };
      return { afterSeconds: Math.min(300, 2 ** metadata.deliveryCount * 5) };
    },
  },
);
