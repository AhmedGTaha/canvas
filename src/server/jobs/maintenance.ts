import { MaintenanceService } from "@/domain/maintenance/service";
import { sql } from "@/server/db/client";
import { emit } from "@/server/observability/telemetry";

/** One-shot housekeeping pass. Safe to schedule as often as every few minutes. */
async function run() {
  const report = await new MaintenanceService().run();
  emit("maintenance.completed", { ...report });
  await sql.end();
}

run().catch(async (error: unknown) => {
  emit("maintenance.failed", { reason: error instanceof Error ? error.message : "unknown" }, "error");
  await sql.end();
  process.exitCode = 1;
});
