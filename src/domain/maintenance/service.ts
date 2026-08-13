import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq, inArray, isNotNull, isNull, lt, sql as drizzleSql } from "drizzle-orm";
import { db, type Database } from "@/server/db/client";
import { editingLeases, exportJobs, generationJobs } from "@/server/db/schema";
import { getObjectStorage, type ObjectStorage } from "@/server/storage";
import { observe } from "@/server/observability/events";

export type MaintenanceReport = {
  expiredLeases: number;
  recoveredJobs: number;
  prunedExports: number;
  cleanedTempDirectories: number;
};

const DEFAULTS = {
  /** A generation job whose worker vanished mid-flight is failed after this long. */
  abandonedJobMinutes: 30,
  /** Completed export ZIPs are retained for this long. */
  exportRetentionDays: 14,
  /** The newest completed export per project is always kept, however old. */
  keepLatestExportPerProject: true,
  /** Build/typecheck scratch directories older than this are removed. */
  tempDirectoryMinutes: 60,
};

/**
 * Idempotent housekeeping. Every operation is safe to run repeatedly and concurrently,
 * and none of them touch immutable history: Media rows, Page/Block Versions, Change
 * Sets, and Checkpoints are never deleted here. Only derived or abandoned state is
 * released — stale leases, jobs whose worker died, expendable export archives, and
 * scratch directories.
 */
export class MaintenanceService {
  constructor(
    private readonly database: Database = db,
    private readonly storage: ObjectStorage = getObjectStorage(),
    private readonly options: typeof DEFAULTS = DEFAULTS,
  ) {}

  async run(): Promise<MaintenanceReport> {
    const started = performance.now();
    const report: MaintenanceReport = {
      expiredLeases: await this.expireLeases(),
      recoveredJobs: await this.recoverAbandonedJobs(),
      prunedExports: await this.pruneExportArtifacts(),
      cleanedTempDirectories: await this.cleanTempDirectories(),
    };
    observe.maintenance("leases_expired", { count: report.expiredLeases, durationMs: performance.now() - started });
    return report;
  }

  /** Releases leases whose holder stopped renewing, unblocking the target for others. */
  async expireLeases() {
    const removed = await this.database.delete(editingLeases).where(lt(editingLeases.expiresAt, new Date())).returning({ id: editingLeases.id });
    return removed.length;
  }

  /**
   * Fails generation and export jobs whose worker disappeared and that have exhausted
   * their retries, so the UI stops showing a permanently "running" job. Jobs still
   * inside their retry budget are left for the worker's own stale-claim recovery.
   */
  async recoverAbandonedJobs() {
    const cutoff = new Date(Date.now() - this.options.abandonedJobMinutes * 60_000);
    const now = new Date();
    const generation = await this.database.update(generationJobs)
      .set({ status: "failed", progressStage: "Failed", errorCode: "AI_INTERNAL_ERROR", errorMessage: "Canvas stopped responding while working on this. Try again.", finishedAt: now })
      .where(and(
        inArray(generationJobs.status, ["preparing_context", "generating", "validating", "applying"]),
        lt(generationJobs.claimedAt, cutoff),
        drizzleSql`${generationJobs.attemptCount} >= 3`,
      )).returning({ id: generationJobs.id });

    const exports = await this.database.update(exportJobs)
      .set({ status: "failed", progressStage: "Failed", errorCode: "EXPORT_FAILED", errorMessage: "Canvas stopped responding while exporting. Start the export again.", finishedAt: now })
      .where(and(
        inArray(exportJobs.status, ["validating", "assembling", "building", "packaging"]),
        lt(exportJobs.claimedAt, cutoff),
        drizzleSql`${exportJobs.attemptCount} >= 2`,
      )).returning({ id: exportJobs.id });

    const count = generation.length + exports.length;
    if (count) observe.maintenance("jobs_recovered", { count });
    return count;
  }

  /**
   * Releases old export ZIPs from object storage. Export job rows and their validation
   * reports are kept for auditing; only the downloadable archive is released, and the
   * newest completed export of each project is preserved.
   */
  async pruneExportArtifacts() {
    const cutoff = new Date(Date.now() - this.options.exportRetentionDays * 24 * 60 * 60_000);
    const candidates = await this.database.select({ id: exportJobs.id, projectId: exportJobs.projectId, storageKey: exportJobs.artifactStorageKey, createdAt: exportJobs.createdAt })
      .from(exportJobs)
      .where(and(eq(exportJobs.status, "completed"), isNotNull(exportJobs.artifactStorageKey), isNull(exportJobs.artifactPrunedAt), lt(exportJobs.createdAt, cutoff)))
      .orderBy(desc(exportJobs.createdAt));

    const keep = new Set<string>();
    if (this.options.keepLatestExportPerProject) {
      for (const projectId of new Set(candidates.map((row) => row.projectId))) {
        const [latest] = await this.database.select({ id: exportJobs.id }).from(exportJobs)
          .where(and(eq(exportJobs.projectId, projectId), eq(exportJobs.status, "completed"), isNull(exportJobs.artifactPrunedAt)))
          .orderBy(desc(exportJobs.createdAt)).limit(1);
        if (latest) keep.add(latest.id);
      }
    }

    let pruned = 0;
    for (const candidate of candidates) {
      if (keep.has(candidate.id) || !candidate.storageKey) continue;
      // Storage first, then the pointer: a repeat run simply deletes nothing.
      try { await this.storage.delete(candidate.storageKey); } catch { continue; }
      await this.database.update(exportJobs).set({ artifactStorageKey: null, artifactPrunedAt: new Date() }).where(eq(exportJobs.id, candidate.id));
      pruned += 1;
    }
    if (pruned) observe.maintenance("exports_pruned", { count: pruned });
    return pruned;
  }

  /** Removes export typecheck scratch directories left behind by a crashed process. */
  async cleanTempDirectories(root = process.cwd()) {
    const cutoff = Date.now() - this.options.tempDirectoryMinutes * 60_000;
    let cleaned = 0;
    let entries: string[];
    try { entries = await readdir(root); } catch { return 0; }
    for (const entry of entries) {
      if (!entry.startsWith(".canvas-export-check-")) continue;
      const target = path.join(root, entry);
      try {
        const info = await stat(target);
        if (!info.isDirectory() || info.mtimeMs > cutoff) continue;
        await rm(target, { recursive: true, force: true });
        cleaned += 1;
      } catch { /* another run removed it first */ }
    }
    if (cleaned) observe.maintenance("temp_cleaned", { count: cleaned });
    return cleaned;
  }
}
