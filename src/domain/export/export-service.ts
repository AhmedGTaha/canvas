import { and, desc, eq, inArray } from "drizzle-orm";
import { db, sql, type Database } from "@/server/db/client";
import { auditEvents, exportJobs, users } from "@/server/db/schema";
import { ProjectAccessService } from "@/server/permissions/project-access";
import { getObjectStorage, type ObjectStorage } from "@/server/storage";
import { fileStem } from "./naming";
import { loadExportState } from "./project-state";
import { ExportValidator, type ExportFailure, type ExportValidationReport } from "./export-validator";
import { ProjectAssembler } from "./project-assembler";
import { BuildValidator } from "./build-validator";
import { ZipPackager } from "./zip-packager";
import { ExportError, exportActive, exportBuildFailed, exportExpired, exportNotFound, exportNotReady, exportValidationFailed } from "./errors";
import { observe } from "@/server/observability/events";

export type ExportJobStatus = typeof exportJobs.$inferSelect.status;
const ACTIVE_STATUSES: ExportJobStatus[] = ["queued", "validating", "assembling", "building", "packaging"];

/**
 * Durable project export. Each job validates the active project, assembles a standalone
 * Next.js app, proves it builds, and packages it as a ZIP in object storage. Canvas
 * stays fully usable while an export runs.
 */
export class ExportService {
  constructor(
    private readonly database: Database = db,
    private readonly access = new ProjectAccessService(),
    private readonly storage: ObjectStorage = getObjectStorage(),
    private readonly validator = new ExportValidator(storage),
    private readonly assembler = new ProjectAssembler(),
    private readonly builder = new BuildValidator(),
    private readonly packager = new ZipPackager(),
  ) {}

  async create(userId: string, projectId: string) {
    await this.access.requireProjectAccess(userId, projectId);
    try {
      const [job] = await this.database.insert(exportJobs).values({ projectId, actorUserId: userId }).returning();
      if (!job) throw new Error("Export job insert did not return a record.");
      await this.database.insert(auditEvents).values({ projectId, userId, action: "export.requested", entityType: "export_job", entityId: job.id });
      observe.exportJob("created", { exportId: job.id, projectId });
      return job;
    } catch (error) {
      const code = (error as { cause?: { code?: string } }).cause?.code;
      if (code === "23505") throw exportActive();
      throw error;
    }
  }

  async list(userId: string, projectId: string) {
    await this.access.requireProjectAccess(userId, projectId);
    const rows = await this.database.select({ job: exportJobs, actor: users.displayName }).from(exportJobs)
      .innerJoin(users, eq(users.id, exportJobs.actorUserId))
      .where(eq(exportJobs.projectId, projectId)).orderBy(desc(exportJobs.createdAt)).limit(20);
    return rows.map(({ job, actor }) => this.present(job, actor));
  }

  async get(userId: string, projectId: string, exportId: string) {
    await this.access.requireProjectAccess(userId, projectId);
    // Project-scoped lookup: an export ID from another project is simply not found.
    const [row] = await this.database.select({ job: exportJobs, actor: users.displayName }).from(exportJobs)
      .innerJoin(users, eq(users.id, exportJobs.actorUserId))
      .where(and(eq(exportJobs.id, exportId), eq(exportJobs.projectId, projectId))).limit(1);
    if (!row) throw exportNotFound();
    return this.present(row.job, row.actor);
  }

  /** Never exposes the storage key; returns the bytes only for a completed export. */
  async download(userId: string, projectId: string, exportId: string) {
    await this.access.requireProjectAccess(userId, projectId);
    const [job] = await this.database.select().from(exportJobs).where(and(eq(exportJobs.id, exportId), eq(exportJobs.projectId, projectId))).limit(1);
    if (!job) throw exportNotFound();
    if (job.status === "completed" && job.artifactPrunedAt) throw exportExpired();
    if (job.status !== "completed" || !job.artifactStorageKey) throw exportNotReady();
    return { bytes: await this.storage.get(job.artifactStorageKey), fileName: job.artifactFileName ?? "website.zip" };
  }

  private present(job: typeof exportJobs.$inferSelect, actor: string) {
    const validation = job.validation as ExportValidationReport | null;
    return {
      id: job.id, status: job.status, progressStage: job.progressStage, actor,
      createdAt: job.createdAt, finishedAt: job.finishedAt,
      errorCode: job.errorCode, errorMessage: job.errorMessage,
      validation: validation ? { ok: validation.ok, checks: validation.checks, failures: validation.failures, pageCount: validation.pageCount, blockCount: validation.blockCount, mediaCount: validation.mediaCount } : null,
      artifact: job.status === "completed" && !job.artifactPrunedAt ? { fileName: job.artifactFileName, bytes: job.artifactBytes, fileCount: job.artifactFileCount } : null,
      expired: job.status === "completed" && Boolean(job.artifactPrunedAt),
    };
  }

  private async transition(exportId: string, status: ExportJobStatus, progressStage: string, patch: Partial<typeof exportJobs.$inferInsert> = {}) {
    const terminal = status === "completed" || status === "failed";
    const [updated] = await this.database.update(exportJobs)
      .set({ ...patch, status, progressStage, startedAt: patch.startedAt ?? undefined, finishedAt: terminal ? new Date() : null })
      .where(and(eq(exportJobs.id, exportId), inArray(exportJobs.status, ACTIVE_STATUSES))).returning();
    return updated ?? null;
  }

  /**
   * Runs one export job end to end. Any failure leaves the job `failed` with a
   * user-safe reason and no downloadable artifact.
   */
  async process(exportId: string) {
    const startedAt = performance.now();
    const [job] = await this.database.select().from(exportJobs).where(eq(exportJobs.id, exportId)).limit(1);
    if (!job || !ACTIVE_STATUSES.includes(job.status)) return job ?? null;
    try {
      await this.transition(exportId, "validating", "Checking your website", { startedAt: new Date() });
      const state = await loadExportState(job.projectId, this.database);
      const report = await this.validator.validate(state);
      await this.database.update(exportJobs).set({ validation: report }).where(eq(exportJobs.id, exportId));
      if (!report.ok) { observe.validationFailed("export", { projectId: job.projectId, jobId: exportId, reason: report.failures[0]?.code }); throw exportValidationFailed(report.failures); }
      observe.exportJob("validated", { exportId, projectId: job.projectId, fileCount: report.pageCount });

      await this.transition(exportId, "assembling", "Building the project files");
      const assembled = await this.assembler.assemble(state);

      await this.transition(exportId, "building", "Verifying the website builds");
      const buildFailures = await this.builder.validate(assembled.files);
      if (buildFailures.length) {
        await this.database.update(exportJobs).set({ validation: { ...report, ok: false, failures: buildFailures } }).where(eq(exportJobs.id, exportId));
        throw exportBuildFailed(buildFailures);
      }

      await this.transition(exportId, "packaging", "Packaging the download");
      const archive = this.packager.pack(assembled.files);
      const fileName = `${fileStem(state.project.name, state.project.id, "website")}.zip`;
      const storageKey = `exports/${job.projectId}/${exportId}.zip`;
      await this.storage.put(storageKey, archive);

      const completed = await this.transition(exportId, "completed", "Ready to download", {
        artifactStorageKey: storageKey, artifactFileName: fileName, artifactBytes: archive.length, artifactFileCount: assembled.files.length,
      });
      await this.database.insert(auditEvents).values({ projectId: job.projectId, userId: job.actorUserId, action: "export.completed", entityType: "export_job", entityId: exportId, metadata: { fileCount: assembled.files.length, bytes: archive.length } });
      observe.exportJob("completed", { exportId, projectId: job.projectId, fileCount: assembled.files.length, bytes: archive.length, durationMs: performance.now() - startedAt });
      return completed;
    } catch (error) {
      const failure = error instanceof ExportError ? error : new ExportError("EXPORT_FAILED", "VALIDATION", "Canvas could not export this website. Try again.");

      const failed = await this.transition(exportId, "failed", "Failed", { errorCode: failure.exportCode, errorMessage: failure.message.slice(0, 500) });
      await this.database.insert(auditEvents).values({ projectId: job.projectId, userId: job.actorUserId, action: "export.failed", entityType: "export_job", entityId: exportId, metadata: { errorCode: failure.exportCode } });
      observe.exportJob("failed", { exportId, projectId: job.projectId, reason: failure.exportCode, durationMs: performance.now() - startedAt });
      return failed;
    }
  }
}

/** Claims the next queued export job for a worker. */
export async function claimExportJob(workerId: string) {
  const rows = await sql<{ id: string }[]>`
    UPDATE export_jobs SET status = 'validating', progress_stage = 'Checking your website', claimed_at = now(),
      worker_id = ${workerId}, attempt_count = attempt_count + 1, started_at = COALESCE(started_at, now())
    WHERE id = (SELECT id FROM export_jobs
      WHERE ((status = 'queued' AND available_at <= now())
             OR (status IN ('validating', 'assembling', 'building', 'packaging') AND claimed_at < now() - interval '15 minutes'))
        AND attempt_count < 2
      ORDER BY available_at, created_at FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING id`;
  if (!rows[0]) return null;
  const [job] = await db.select().from(exportJobs).where(eq(exportJobs.id, rows[0].id)).limit(1);
  return job ?? null;
}

export type { ExportFailure };
