import { handleCallback } from "@vercel/queue";
import { exportJobMessageSchema } from "@/server/queue/export-queue";
import { executeExportJob, runExportWatchdog } from "@/server/jobs/export-execution";
import { observe } from "@/server/observability/events";

/** Vercel Queues push consumer. The message carries only an export job pointer. */
export const maxDuration = 300;

export const POST = handleCallback(async (message, metadata) => {
  const parsed = exportJobMessageSchema.safeParse(message);
  if (!parsed.success) {
    // Ack malformed messages: retrying untrusted invalid input cannot make it valid.
    observe.exportDelivery("skipped", { jobId: "invalid", reason: "invalid_message", deliveryCount: metadata.deliveryCount });
    return;
  }
  if (parsed.data.type === "watchdog") {
    const result = await runExportWatchdog(parsed.data.jobId, parsed.data.round ?? 1);
    observe.exportDelivery("watchdog", { jobId: parsed.data.jobId, deliveryCount: metadata.deliveryCount, round: parsed.data.round, verdict: result.verdict, reason: result.reason });
    return;
  }
  const result = await executeExportJob(parsed.data.jobId, { workerId: `queue:${metadata.messageId}`.slice(0, 120) });
  observe.exportDelivery(result.outcome, { jobId: parsed.data.jobId, deliveryCount: metadata.deliveryCount, reason: "reason" in result ? result.reason : undefined, status: result.outcome === "processed" ? result.status : undefined, retryAfterSeconds: "retryAfterSeconds" in result ? result.retryAfterSeconds : undefined });
}, { visibilityTimeoutSeconds: 300 });
