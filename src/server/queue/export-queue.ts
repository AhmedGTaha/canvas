import { DuplicateMessageError, send } from "@vercel/queue";
import { z } from "zod";
import { observe } from "@/server/observability/events";

/** Pointer-only queue transport for durable export jobs. */
export const EXPORT_JOB_TOPIC = "canvas-export-jobs";
export const EXPORT_WATCHDOG_DELAY_SECONDS = 300;
export const EXPORT_WATCHDOG_MAX_ROUNDS = 6;

export const exportJobMessageSchema = z.object({
  jobId: z.uuid(),
  type: z.enum(["execute", "watchdog"]).default("execute"),
  round: z.number().int().min(1).max(EXPORT_WATCHDOG_MAX_ROUNDS).optional(),
});
export type ExportJobMessage = z.infer<typeof exportJobMessageSchema>;
export type ExportDispatchMode = "queue" | "worker";
export type ExportDispatchReason = "created" | "retry" | "recovery" | "watchdog";
export type ExportDispatchResult =
  | { mode: "worker"; published: false }
  | { mode: "queue"; published: true; messageId: string | null; duplicate: boolean }
  | { mode: "queue"; published: false; reason: string };

/** Vercel functions always use the queue; the local worker remains the default elsewhere. */
export function exportDispatchMode(): ExportDispatchMode {
  const configured = process.env.CANVAS_EXPORT_DISPATCH;
  if (configured === "queue" || configured === "worker") return configured;
  return process.env.VERCEL ? "queue" : "worker";
}

export type ExportQueueTransport = (input: { message: ExportJobMessage; idempotencyKey: string; delaySeconds: number }) => Promise<{ messageId: string | null }>;
const vercelTransport: ExportQueueTransport = async ({ message, idempotencyKey, delaySeconds }) =>
  send<ExportJobMessage>(EXPORT_JOB_TOPIC, message, { idempotencyKey, ...(delaySeconds > 0 ? { delaySeconds } : {}) });
let transport: ExportQueueTransport = vercelTransport;

/** Test seam. Runtime code uses the Vercel Queue transport. */
export function setExportQueueTransport(next: ExportQueueTransport | null) { transport = next ?? vercelTransport; }

async function publish(input: { jobId: string; attempt: number; delaySeconds?: number; dedupeSalt?: string; message?: ExportJobMessage }): Promise<ExportDispatchResult> {
  if (exportDispatchMode() === "worker") return { mode: "worker", published: false };
  const delaySeconds = Math.max(0, Math.ceil(input.delaySeconds ?? 0));
  const idempotencyKey = input.dedupeSalt ? `${input.jobId}:${input.attempt}:${input.dedupeSalt}` : `${input.jobId}:${input.attempt}`;
  try {
    const { messageId } = await transport({ message: input.message ?? { jobId: input.jobId, type: "execute" }, idempotencyKey, delaySeconds });
    return { mode: "queue", published: true, messageId, duplicate: false };
  } catch (error) {
    if (error instanceof DuplicateMessageError) return { mode: "queue", published: true, messageId: null, duplicate: true };
    throw error;
  }
}

export async function scheduleExportWatchdog(input: { jobId: string; projectId: string; attempt: number; round: number; delaySeconds?: number }): Promise<ExportDispatchResult> {
  if (input.round > EXPORT_WATCHDOG_MAX_ROUNDS) return { mode: "queue", published: false, reason: "watchdog_rounds_exhausted" };
  try {
    const result = await publish({ jobId: input.jobId, attempt: input.attempt, delaySeconds: input.delaySeconds ?? EXPORT_WATCHDOG_DELAY_SECONDS, dedupeSalt: `watchdog:${input.round}`, message: { jobId: input.jobId, type: "watchdog", round: input.round } });
    observe.exportDispatch(result.mode === "worker" ? "skipped" : "published", { jobId: input.jobId, projectId: input.projectId, mode: result.mode, reason: "watchdog", attempt: input.attempt, round: input.round, duplicate: result.mode === "queue" && result.published ? result.duplicate : undefined });
    return result;
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    observe.exportDispatch("failed", { jobId: input.jobId, projectId: input.projectId, mode: "queue", reason: "watchdog", attempt: input.attempt, round: input.round, error: reason });
    return { mode: "queue", published: false, reason };
  }
}

/** Dispatch after a committed row; failures leave that row recoverable by its watchdog. */
export async function dispatchExportJob(input: { jobId: string; projectId: string; attempt: number; reason: ExportDispatchReason; delaySeconds?: number; dedupeSalt?: string; arm?: boolean; watchdogRound?: number }): Promise<ExportDispatchResult> {
  let result: ExportDispatchResult;
  try {
    result = await publish(input);
    observe.exportDispatch(result.mode === "worker" ? "skipped" : "published", { jobId: input.jobId, projectId: input.projectId, mode: result.mode, reason: input.reason, attempt: input.attempt, duplicate: result.mode === "queue" && result.published ? result.duplicate : undefined });
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    observe.exportDispatch("failed", { jobId: input.jobId, projectId: input.projectId, mode: "queue", reason: input.reason, attempt: input.attempt, error: reason });
    result = { mode: "queue", published: false, reason };
  }
  if (input.arm !== false && result.mode === "queue") {
    await scheduleExportWatchdog({ jobId: input.jobId, projectId: input.projectId, attempt: input.attempt, round: input.watchdogRound ?? 1, delaySeconds: Math.max(EXPORT_WATCHDOG_DELAY_SECONDS, Math.ceil(input.delaySeconds ?? 0) + EXPORT_WATCHDOG_DELAY_SECONDS) });
  }
  return result;
}
