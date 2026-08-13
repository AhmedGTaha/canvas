import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { claimGenerationJob } from "@/domain/ai/job-service";
import { ExportService, claimExportJob } from "@/domain/export/export-service";
import { MaintenanceService } from "@/domain/maintenance/service";
import { emit } from "@/server/observability/telemetry";
import { AIOrchestrationService } from "@/domain/ai/orchestration-service";
import { finalizeQueuedFollowUp, promoteQueuedFollowUp } from "@/domain/ai-queue/service";
import { sql } from "@/server/db/client";

const workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
let stopping = false;
const MAINTENANCE_INTERVAL_MS = 5 * 60_000;
let lastMaintenance = Date.now();
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

async function run() {
  emit("worker.started", { workerId });
  while (!stopping) {
    await promoteQueuedFollowUp();
    const job = await claimGenerationJob(workerId);
    if (job) { const result = await new AIOrchestrationService().process(job.id); if (result && ["completed", "failed", "cancelled"].includes(result.status)) await finalizeQueuedFollowUp(job.id, result.status); continue; }
    const exportJob = await claimExportJob(workerId);
    if (exportJob) { await new ExportService().process(exportJob.id); continue; }
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
