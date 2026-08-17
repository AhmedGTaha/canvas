import { randomUUID } from "node:crypto";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ExportService, MAX_EXPORT_ATTEMPTS } from "@/domain/export/export-service";
import { PageTreeService } from "@/domain/pages/service";
import { ProjectService } from "@/domain/projects/service";
import { WorkspaceService } from "@/domain/workspaces/service";
import { db, sql } from "@/server/db/client";
import { auditEvents, exportJobs, pageNodes, pageVersions, users } from "@/server/db/schema";
import { EXPORT_WATCHDOG_MAX_ROUNDS, setExportQueueTransport, type ExportJobMessage } from "@/server/queue/export-queue";
import { executeExportJob, recoverStalledExportJobs, runExportWatchdog } from "./export-execution";

type Published = { message: ExportJobMessage; idempotencyKey: string; delaySeconds: number };
const published: Published[] = [];

async function projectFixture(name = "Site") {
  const id = randomUUID();
  const [owner] = await db.insert(users).values({ id, email: `${id}@test.dev`, normalizedEmail: `${id}@test.dev`, displayName: "Owner" }).returning();
  const workspace = await new WorkspaceService().create(owner!.id, { name: "Workspace" });
  const project = await new ProjectService().create(owner!.id, { workspaceId: workspace.id, name });
  const page = await new PageTreeService().create(owner!.id, { projectId: project.id, type: "page", name: "Home" });
  const [version] = await db.insert(pageVersions).values({
    projectId: project.id, pageId: page.id, versionNumber: 1,
    document: { schemaVersion: 1, html: `<main class="c-page" data-canvas-id="${page.id}"><h1>${name}</h1></main>`, css: "", js: "", metadata: null },
    manifest: { referencedMediaIds: [], internalRoutes: [], blockUsages: [] }, seoMetadata: {}, changeSummary: {}, sourceHash: "a".repeat(64), createdByUserId: owner!.id,
  }).returning();
  await db.update(pageNodes).set({ currentVersionId: version!.id }).where(eq(pageNodes.id, page.id));
  return { owner: owner!, project };
}

async function queuedExport(name?: string) {
  const fixture = await projectFixture(name);
  const job = await new ExportService().create(fixture.owner.id, fixture.project.id);
  return { ...fixture, job };
}

const executions = () => published.filter(({ message }) => message.type === "execute");
const watchdogs = () => published.filter(({ message }) => message.type === "watchdog");

// Real PostgreSQL plus archive creation is slower than Vitest's default unit-test budget.
describe.sequential("Vercel Queues export execution", { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await sql`TRUNCATE TABLE export_jobs, project_checkpoint_items, project_checkpoints, change_set_items, change_sets, building_block_usages, building_block_versions, building_blocks, generation_job_media, page_versions, ai_job_rate_limits, generation_jobs, ai_messages, ai_conversations, project_instructions, media_assets, media_folders, page_nodes, audit_events, editing_leases, project_invites, project_members, auth_rate_limits, sessions, auth_credentials, projects, workspaces, users RESTART IDENTITY CASCADE`;
    published.length = 0;
    process.env.CANVAS_EXPORT_DISPATCH = "queue";
    setExportQueueTransport(async (entry) => {
      published.push(entry);
      return { messageId: `message-${published.length}` };
    });
  });

  afterEach(() => {
    setExportQueueTransport(null);
    delete process.env.CANVAS_EXPORT_DISPATCH;
  });

  afterAll(async () => {
    await rm(path.resolve(process.cwd(), process.env.LOCAL_STORAGE_PATH || ".canvas-storage", "exports"), { recursive: true, force: true });
    await sql.end();
  });

  it("publishes only a durable pointer and processes that queued export to a private archive", async () => {
    const { owner, project, job } = await queuedExport();
    expect(executions()).toEqual([{ message: { jobId: job.id, type: "execute" }, idempotencyKey: `${job.id}:0`, delaySeconds: 0 }]);
    expect(watchdogs()).toHaveLength(1);
    expect(Object.keys(executions()[0]!.message)).toEqual(["jobId", "type"]);
    expect(JSON.stringify(published)).not.toMatch(/<main|zip|storage|token|secret|credential|bytes/i);

    const result = await executeExportJob(job.id, { workerId: "queue:one" });
    expect(result).toEqual({ outcome: "processed", jobId: job.id, status: "completed" });
    const state = await new ExportService().get(owner.id, project.id, job.id);
    expect(state.status).toBe("completed");
    expect(state.artifact?.fileName).toMatch(/\.zip$/);
    expect((await new ExportService().download(owner.id, project.id, job.id)).bytes.byteLength).toBeGreaterThan(0);
  });

  it("handles duplicate delivery exactly once without another archive or invalid claim state", async () => {
    const { owner, project, job } = await queuedExport();
    const first = await executeExportJob(job.id, { workerId: "queue:first" });
    const duplicate = await executeExportJob(job.id, { workerId: "queue:duplicate" });
    const [stored] = await db.select().from(exportJobs).where(eq(exportJobs.id, job.id));
    const completedEvents = await db.select().from(auditEvents).where(eq(auditEvents.entityId, job.id));
    const exportDirectory = path.resolve(process.cwd(), process.env.LOCAL_STORAGE_PATH || ".canvas-storage", "exports", project.id);

    expect(first).toEqual({ outcome: "processed", jobId: job.id, status: "completed" });
    expect(duplicate).toEqual({ outcome: "skipped", jobId: job.id, reason: "terminal" });
    expect(stored).toMatchObject({ status: "completed", attemptCount: 1, workerId: "queue:first" });
    expect(completedEvents.filter((event) => event.action === "export.completed")).toHaveLength(1);
    expect((await readdir(exportDirectory)).filter((file) => file.endsWith(".zip"))).toEqual([`${job.id}.zip`]);
    expect((await new ExportService().download(owner.id, project.id, job.id)).bytes.byteLength).toBeGreaterThan(0);
  });

  it("does not reclaim completed or terminal failed exports", async () => {
    const completed = await queuedExport("Completed");
    await db.update(exportJobs).set({ status: "completed", progressStage: "Ready to download", artifactStorageKey: "exports/completed.zip", artifactFileName: "completed.zip", artifactBytes: 1, artifactFileCount: 1, finishedAt: new Date() }).where(eq(exportJobs.id, completed.job.id));
    const failed = await queuedExport("Failed");
    await db.update(exportJobs).set({ status: "failed", progressStage: "Failed", finishedAt: new Date(), errorCode: "EXPORT_FAILED" }).where(eq(exportJobs.id, failed.job.id));

    expect(await executeExportJob(completed.job.id, { workerId: "queue:completed" })).toEqual({ outcome: "skipped", jobId: completed.job.id, reason: "terminal" });
    expect(await executeExportJob(failed.job.id, { workerId: "queue:failed" })).toEqual({ outcome: "skipped", jobId: failed.job.id, reason: "terminal" });
  });

  it("watchdog republishes stalled work, leaves healthy work alone, settles terminal work, and stops at its bound", async () => {
    const stalled = await queuedExport("Stalled");
    await db.update(exportJobs).set({ availableAt: new Date(Date.now() - 120_000) }).where(eq(exportJobs.id, stalled.job.id));
    published.length = 0;
    expect(await runExportWatchdog(stalled.job.id, 1)).toEqual({ jobId: stalled.job.id, round: 1, verdict: "republished" });
    expect(executions()).toHaveLength(1);
    expect(watchdogs()).toEqual([{ message: { jobId: stalled.job.id, type: "watchdog", round: 2 }, idempotencyKey: `${stalled.job.id}:0:watchdog:2`, delaySeconds: 300 }]);

    const healthy = await queuedExport("Healthy");
    await db.update(exportJobs).set({ status: "validating", claimedAt: new Date(), attemptCount: 1 }).where(eq(exportJobs.id, healthy.job.id));
    published.length = 0;
    expect(await runExportWatchdog(healthy.job.id, 1)).toMatchObject({ verdict: "healthy", reason: "in_flight" });
    expect(executions()).toHaveLength(0);
    expect(watchdogs()).toHaveLength(1);

    await db.update(exportJobs).set({ status: "completed", artifactStorageKey: "exports/healthy.zip", artifactFileName: "healthy.zip", artifactBytes: 1, artifactFileCount: 1, finishedAt: new Date() }).where(eq(exportJobs.id, healthy.job.id));
    published.length = 0;
    expect(await runExportWatchdog(healthy.job.id, 1)).toMatchObject({ verdict: "settled", reason: "terminal" });
    expect(published).toHaveLength(0);

    const bounded = await queuedExport("Bounded");
    published.length = 0;
    expect(await runExportWatchdog(bounded.job.id, EXPORT_WATCHDOG_MAX_ROUNDS)).toEqual({ jobId: bounded.job.id, round: EXPORT_WATCHDOG_MAX_ROUNDS, verdict: "exhausted" });
    expect(published).toHaveLength(0);
  });

  it("daily recovery republishes only stale recoverable jobs and never exceeds the retry limit", async () => {
    const stale = await queuedExport("Stale");
    await db.update(exportJobs).set({ availableAt: new Date(Date.now() - 120_000) }).where(eq(exportJobs.id, stale.job.id));
    const healthy = await queuedExport("Future");
    await db.update(exportJobs).set({ availableAt: new Date(Date.now() + 120_000) }).where(eq(exportJobs.id, healthy.job.id));
    const exhausted = await queuedExport("Exhausted");
    await db.update(exportJobs).set({ availableAt: new Date(Date.now() - 120_000), attemptCount: MAX_EXPORT_ATTEMPTS }).where(eq(exportJobs.id, exhausted.job.id));
    const terminal = await queuedExport("Terminal");
    await db.update(exportJobs).set({ status: "failed", finishedAt: new Date() }).where(eq(exportJobs.id, terminal.job.id));
    published.length = 0;

    expect(await recoverStalledExportJobs()).toEqual({ candidates: 1, republished: 1 });
    expect(executions()).toHaveLength(1);
    expect(executions()[0]!.message.jobId).toBe(stale.job.id);
    expect(executions().map(({ message }) => message.jobId)).not.toContain(healthy.job.id);
    expect(executions().map(({ message }) => message.jobId)).not.toContain(exhausted.job.id);
    expect(executions().map(({ message }) => message.jobId)).not.toContain(terminal.job.id);
  });
});
