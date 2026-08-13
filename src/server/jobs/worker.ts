import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { claimGenerationJob } from "@/domain/ai/job-service";
import { ExportService, claimExportJob } from "@/domain/export/export-service";
import { AIOrchestrationService } from "@/domain/ai/orchestration-service";
import { sql } from "@/server/db/client";

const workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

async function run() {
  console.info(JSON.stringify({ event: "ai.worker.started", workerId }));
  while (!stopping) {
    const job = await claimGenerationJob(workerId);
    if (job) { console.info(JSON.stringify({ event: "ai.job.started", jobId: job.id, workerId })); await new AIOrchestrationService().process(job.id); continue; }
    const exportJob = await claimExportJob(workerId);
    if (exportJob) { console.info(JSON.stringify({ event: "export.job.started", jobId: exportJob.id, workerId })); await new ExportService().process(exportJob.id); continue; }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  await sql.end();
}

run().catch(async (error: unknown) => { console.error(JSON.stringify({ event: "ai.worker.failed", message: error instanceof Error ? error.message : "Unknown worker error" })); await sql.end(); process.exitCode = 1; });

