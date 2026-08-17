import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { claimGenerationJob } from "@/domain/ai/job-service";
import { claimExportJob } from "@/domain/export/export-service";
import { MaintenanceService } from "@/domain/maintenance/service";
import { emit } from "@/server/observability/telemetry";
import { runClaimedGenerationJob } from "@/server/jobs/generation-execution";
import { promoteQueuedFollowUp } from "@/domain/ai-queue/service";
import { generationDispatchMode } from "@/server/queue/generation-queue";
import { exportDispatchMode } from "@/server/queue/export-queue";
import { runClaimedExportJob } from "@/server/jobs/export-execution";
import { sql } from "@/server/db/client";

/**
 * Development-only runner.
 *
 * Production runs generation through the Vercel Queues push consumer at
 * `/api/queues/generation-jobs`; nothing here is required for it. This process exists so
 * a local checkout can run generation and exports without a linked Vercel project.
 *
 * It shares `runClaimedGenerationJob` with the consumer, so generation is orchestrated in
 * exactly one place.
 */
const workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
let stopping = false;
const MAINTENANCE_INTERVAL_MS = 5 * 60_000;
let lastMaintenance = Date.now();
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

async function run() {
  if (generationDispatchMode() === "queue") {
    // Jobs are published to Vercel Queues, so polling here would race the consumer.
    emit("worker.generation_disabled", { workerId, reason: "dispatch_mode_queue" }, "warn");
  }
  if (exportDispatchMode() === "queue") emit("worker.export_disabled", { workerId, reason: "dispatch_mode_queue" }, "warn");
  emit("worker.started", { workerId, generationDispatch: generationDispatchMode(), exportDispatch: exportDispatchMode() });
  while (!stopping) {
    if (generationDispatchMode() === "worker") {
      await promoteQueuedFollowUp();
      const job = await claimGenerationJob(workerId);
      if (job) { await runClaimedGenerationJob(job.id); continue; }
    }
    if (exportDispatchMode() === "worker") {
      const exportJob = await claimExportJob(workerId);
      if (exportJob) { await runClaimedExportJob(exportJob.id); continue; }
    }
    // Housekeeping runs on the idle path so it never delays queued work.
    if (Date.now() - lastMaintenance > MAINTENANCE_INTERVAL_MS) {
      lastMaintenance = Date.now();
      await new MaintenanceService().run().catch((error: unknown) => emit("maintenance.failed", { reason: error instanceof Error ? error.message : "unknown" }, "error"));
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  await sql.end();
}

run().catch(async (error: unknown) => { emit("worker.failed", { reason: error instanceof Error ? error.message : "unknown" }, "error"); await sql.end(); process.exitCode = 1; });
