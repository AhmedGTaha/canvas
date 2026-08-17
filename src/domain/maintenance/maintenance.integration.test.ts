import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile, utimes, readdir } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, sql } from "@/server/db/client";
import { buildingBlockVersions, editingLeases, exportJobs, generationJobs, mediaAssets, pageVersions, projects, users } from "@/server/db/schema";
import { WorkspaceService } from "@/domain/workspaces/service";
import { ProjectService } from "@/domain/projects/service";
import { PageTreeService } from "@/domain/pages/service";
import { EditingLeaseService } from "@/domain/collaboration/lease-service";
import { getObjectStorage } from "@/server/storage";
import { MaintenanceService } from "@/domain/maintenance/service";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
async function makeUser(label: string) { const id = randomUUID(); const [record] = await db.insert(users).values({ id, email: `${label}-${id}@test.dev`, normalizedEmail: `${label}-${id}@test.dev`, displayName: label }).returning(); return record!; }
async function setup() {
  const owner = await makeUser("owner");
  const workspace = await new WorkspaceService().create(owner.id, { name: "Workspace" });
  const project = await new ProjectService().create(owner.id, { workspaceId: workspace.id, name: "Site" });
  const home = await new PageTreeService().create(owner.id, { projectId: project.id, type: "page", name: "Home" });
  return { owner, project, home };
}
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000);

describe.sequential("maintenance and retention", { timeout: 60_000 }, () => {
  beforeEach(async () => { await sql`TRUNCATE TABLE export_jobs, project_checkpoint_items, project_checkpoints, change_set_items, change_sets, building_block_usages, building_block_versions, building_blocks, generation_job_media, page_versions, ai_job_rate_limits, generation_jobs, ai_messages, ai_conversations, project_instructions, media_assets, media_folders, page_nodes, audit_events, editing_leases, project_invites, project_members, auth_rate_limits, sessions, auth_credentials, projects, workspaces, users RESTART IDENTITY CASCADE`; });
  afterAll(async () => {
    await rm(path.resolve(process.cwd(), process.env.LOCAL_STORAGE_PATH || ".canvas-storage", "test-maintenance"), { recursive: true, force: true });
    await sql.end();
  });

  it("expires only leases that are past their expiry", async () => {
    const { owner, project, home } = await setup();
    const leases = new EditingLeaseService();
    await leases.acquire(owner.id, { projectId: project.id, targetType: "page", targetId: home.id });
    expect(await new MaintenanceService().expireLeases()).toBe(0);

    await db.update(editingLeases).set({ expiresAt: ago(5) }).where(eq(editingLeases.projectId, project.id));
    expect(await new MaintenanceService().expireLeases()).toBe(1);
    expect(await db.select().from(editingLeases)).toHaveLength(0);
    // Idempotent: a second pass finds nothing and the target is free again.
    expect(await new MaintenanceService().expireLeases()).toBe(0);
    await expect(leases.acquire(owner.id, { projectId: project.id, targetType: "page", targetId: home.id })).resolves.toBeDefined();
  });

  it("fails abandoned jobs only after their retries are exhausted", async () => {
    const { owner, project, home } = await setup();
    const second = await new PageTreeService().create(owner.id, { projectId: project.id, type: "page", name: "About" });
    const base = { projectId: project.id, actorUserId: owner.id, targetType: "page" as const, provider: "fixture" };
    const [retryable] = await db.insert(generationJobs).values({ ...base, targetId: home.id, operation: "page_generate", status: "generating", claimedAt: ago(45), attemptCount: 1 }).returning();
    const [exhausted] = await db.insert(generationJobs).values({ ...base, targetId: second.id, operation: "page_modify", status: "applying", claimedAt: ago(45), attemptCount: 3 }).returning();
    const [fresh] = await db.insert(generationJobs).values({ ...base, operation: "assistant", targetType: "project", targetId: null, status: "generating", claimedAt: new Date(), attemptCount: 3 }).returning();
    const [staleExport] = await db.insert(exportJobs).values({ projectId: project.id, actorUserId: owner.id, status: "building", claimedAt: ago(45), attemptCount: 2 }).returning();

    expect(await new MaintenanceService().recoverAbandonedJobs()).toBe(2);
    expect((await db.select().from(generationJobs).where(eq(generationJobs.id, exhausted!.id)))[0]).toMatchObject({ status: "failed", errorCode: "AI_INTERNAL_ERROR" });
    expect((await db.select().from(exportJobs).where(eq(exportJobs.id, staleExport!.id)))[0]).toMatchObject({ status: "failed", errorCode: "EXPORT_FAILED" });
    // Still retryable or still alive: left for the worker's own recovery.
    expect((await db.select().from(generationJobs).where(eq(generationJobs.id, retryable!.id)))[0]?.status).toBe("generating");
    expect((await db.select().from(generationJobs).where(eq(generationJobs.id, fresh!.id)))[0]?.status).toBe("generating");
    expect(await new MaintenanceService().recoverAbandonedJobs()).toBe(0);
  });

  it("prunes old export archives while keeping each project's newest download", async () => {
    const { owner, project } = await setup();
    const storage = getObjectStorage();
    const make = async (createdAt: Date) => {
      const key = `test-maintenance/${randomUUID()}.zip`;
      await storage.put(key, PNG);
      const [job] = await db.insert(exportJobs).values({ projectId: project.id, actorUserId: owner.id, status: "completed", progressStage: "Ready", artifactStorageKey: key, artifactFileName: "site.zip", artifactBytes: PNG.length, artifactFileCount: 3, createdAt, finishedAt: createdAt }).returning();
      return { job: job!, key };
    };
    // Every export here is past the retention window.
    const newest = await make(new Date(Date.now() - 40 * 24 * 60 * 60_000));
    const oldest = await make(new Date(Date.now() - 60 * 24 * 60 * 60_000));

    expect(await new MaintenanceService().pruneExportArtifacts()).toBe(1);
    expect((await db.select().from(exportJobs).where(eq(exportJobs.id, oldest.job.id)))[0]).toMatchObject({ artifactStorageKey: null, artifactPrunedAt: expect.any(Date), status: "completed" });
    expect(await storage.exists(oldest.key)).toBe(false);
    // The project's newest completed export is preserved however old it is.
    expect((await db.select().from(exportJobs).where(eq(exportJobs.id, newest.job.id)))[0]?.artifactStorageKey).toBe(newest.key);
    expect(await storage.exists(newest.key)).toBe(true);
    expect(await new MaintenanceService().pruneExportArtifacts()).toBe(0);

    // A fresher export takes over as the one worth keeping; exports inside the
    // retention window are never candidates themselves.
    const recent = await make(new Date(Date.now() - 2 * 24 * 60 * 60_000));
    expect(await new MaintenanceService().pruneExportArtifacts()).toBe(1);
    expect((await db.select().from(exportJobs).where(eq(exportJobs.id, newest.job.id)))[0]?.artifactStorageKey).toBeNull();
    expect((await db.select().from(exportJobs).where(eq(exportJobs.id, recent.job.id)))[0]?.artifactStorageKey).toBe(recent.key);
    expect(await new MaintenanceService().pruneExportArtifacts()).toBe(0);
  });

  it("never deletes Media, Page Versions, or Block Versions", async () => {
    const { owner, project, home } = await setup();
    const storageKey = `test-maintenance/${randomUUID()}.png`;
    await getObjectStorage().put(storageKey, PNG);
    const [asset] = await db.insert(mediaAssets).values({ projectId: project.id, originalFilename: "a.png", displayName: "A", storageKey, mimeType: "image/png", sizeBytes: PNG.length, width: 1, height: 1, createdByUserId: owner.id }).returning();
    // A soft-deleted asset that a historical version still depends on.
    await db.update(mediaAssets).set({ deletedAt: ago(60 * 24 * 90) }).where(eq(mediaAssets.id, asset!.id));
    const [version] = await db.insert(pageVersions).values({ projectId: project.id, pageId: home.id, versionNumber: 1, document: { schemaVersion: 1, html: `<main data-canvas-id="page"><h1>Page</h1></main>`, css: "", js: "", metadata: null }, manifest: { referencedMediaIds: [asset!.id] }, seoMetadata: {}, changeSummary: {}, sourceHash: "a".repeat(64), createdByUserId: owner.id }).returning();

    await new MaintenanceService().run();

    expect(await db.select().from(mediaAssets).where(eq(mediaAssets.id, asset!.id))).toHaveLength(1);
    expect(await getObjectStorage().exists(storageKey)).toBe(true);
    expect(await db.select().from(pageVersions).where(eq(pageVersions.id, version!.id))).toHaveLength(1);
    expect(await db.select().from(buildingBlockVersions)).toHaveLength(0);
  });

  it("keeps archived and soft-deleted projects and their data recoverable", async () => {
    const { owner, project, home } = await setup();
    const [version] = await db.insert(pageVersions).values({ projectId: project.id, pageId: home.id, versionNumber: 1, document: { schemaVersion: 1, html: `<main data-canvas-id="page"><h1>Page</h1></main>`, css: "", js: "", metadata: null }, manifest: {}, seoMetadata: {}, changeSummary: {}, sourceHash: "b".repeat(64), createdByUserId: owner.id }).returning();
    await db.update(projects).set({ status: "archived" }).where(eq(projects.id, project.id));

    await new MaintenanceService().run();

    // Maintenance never purges projects: restoring the status brings everything back.
    expect((await db.select().from(projects).where(eq(projects.id, project.id)))[0]).toMatchObject({ status: "archived" });
    // A soft-deleted project is equally untouched by housekeeping.
    await db.update(projects).set({ status: "deleted", deletedAt: ago(60 * 24 * 120) }).where(eq(projects.id, project.id));
    await new MaintenanceService().run();
    expect((await db.select().from(projects).where(eq(projects.id, project.id)))[0]).toMatchObject({ status: "deleted" });
    expect(await db.select().from(pageVersions).where(eq(pageVersions.id, version!.id))).toHaveLength(1);
    await db.update(projects).set({ status: "active", deletedAt: null }).where(eq(projects.id, project.id));
    await expect(new ProjectService().read(owner.id, project.id)).resolves.toMatchObject({ id: project.id, status: "active" });
  });

  it("removes only stale export scratch directories", async () => {
    const root = path.join(process.cwd(), `.canvas-maintenance-test-${randomUUID()}`);
    await mkdir(root, { recursive: true });
    try {
      const stale = path.join(root, ".canvas-export-check-stale");
      const fresh = path.join(root, ".canvas-export-check-fresh");
      const unrelated = path.join(root, "keep-me");
      for (const directory of [stale, fresh, unrelated]) { await mkdir(directory, { recursive: true }); await writeFile(path.join(directory, "file.txt"), "x"); }
      const old = new Date(Date.now() - 5 * 60 * 60_000);
      await utimes(stale, old, old);

      expect(await new MaintenanceService().cleanTempDirectories(root)).toBe(1);
      const remaining = await readdir(root);
      expect(remaining.sort()).toEqual([".canvas-export-check-fresh", "keep-me"]);
      expect(await new MaintenanceService().cleanTempDirectories(root)).toBe(0);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("runs a full pass idempotently on an untouched project", async () => {
    const { owner, project, home } = await setup();
    await new EditingLeaseService().acquire(owner.id, { projectId: project.id, targetType: "page", targetId: home.id });
    const first = await new MaintenanceService().run();
    const second = await new MaintenanceService().run();
    expect(first).toEqual({ expiredLeases: 0, recoveredJobs: 0, prunedExports: 0, cleanedTempDirectories: 0 });
    expect(second).toEqual(first);
    expect(await db.select().from(editingLeases).where(and(eq(editingLeases.projectId, project.id), eq(editingLeases.targetId, home.id)))).toHaveLength(1);
  });
});
