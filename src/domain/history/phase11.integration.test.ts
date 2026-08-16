import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, sql } from "@/server/db/client";
import { projectBrandSettings, buildingBlockUsages, buildingBlockVersions, buildingBlocks, changeSetItems, changeSets, generationJobs, mediaAssets, pageNodes, pageVersions, projectCheckpointItems, projectCheckpoints, projectMembers, users } from "@/server/db/schema";
import { WorkspaceService } from "@/domain/workspaces/service";
import { ProjectService } from "@/domain/projects/service";
import { PageTreeService } from "@/domain/pages/service";
import { BuildingBlockService } from "@/domain/blocks/service";
import { GenerationJobService, claimGenerationJob } from "@/domain/ai/job-service";
import { AIOrchestrationService } from "@/domain/ai/orchestration-service";
import type { AIProvider, AIRequest, AIResponse, StructuredValidator } from "@/domain/ai/provider";
import { HistoryService } from "@/domain/history/undo-service";
import { VersionRestoreService } from "@/domain/history/restore-service";
import { CheckpointService } from "@/domain/history/checkpoint-service";
import { PreviewManifestService } from "@/generated-runtime/manifest/service";
import { GeneratedPageContentProvider } from "@/generated-runtime/preview/generated-page-provider";
import { fixtureProviderResolver } from "@/domain/ai/testing/provider-fixtures";

const HERO = `<section data-canvas-id="hero-main"><h1>Original hero</h1></section>`;
const page = (body: string) => `export default function Page(){return <main className="c-page">${HERO}${body}</main>}`;
const pageV1 = page(`<article data-canvas-id="pricing-card"><p>Spacious card</p></article>`);
const pageV2 = page(`<article data-canvas-id="pricing-card"><p>Compact card</p></article>`);
const pageV3 = page(`<article data-canvas-id="pricing-card"><p>Tiny card</p></article>`);
const navbarV1 = `export default function Block(){return <nav data-canvas-id="navbar-root"><span>Navbar version one</span></nav>}`;
const navbarV2 = `export default function Block(){return <nav data-canvas-id="navbar-root"><span>Navbar version two</span></nav>}`;
const usingNavbar = (blockId: string) => `import { CanvasBlock } from "@canvas/site-runtime";\nexport default function Page(){return <main className="c-page"><CanvasBlock blockId="${blockId}" usageKey="site-navbar" />${HERO}</main>}`;

type FixtureOptions = { blockUsages?: Array<{ blockId: string; usageKey: string }>; targetCanvasId?: string | null; referencedMediaIds?: string[] };
class FixtureProvider implements AIProvider { readonly capabilities = { structuredOutput: true, vision: true };
  name = "fixture"; model = "fixture-1";
  constructor(private readonly source: string, private readonly options: FixtureOptions = {}) {}
  async generateText(): Promise<AIResponse> { return { text: "", provider: this.name, model: this.model }; }
  async generateStructured<T>(_request: AIRequest, validator: StructuredValidator<T>): Promise<AIResponse<T>> {
    const value = {
      schemaVersion: 1, sourceCode: this.source, referencedMediaIds: this.options.referencedMediaIds ?? [],
      ...(this.options.blockUsages?.length ? { blockUsages: this.options.blockUsages } : {}),
      ...(this.options.targetCanvasId === undefined ? {} : { targetCanvasId: this.options.targetCanvasId }),
      summary: { headline: "Applied the change", changes: ["Updated content"], limitations: [] },
    };
    return { text: "", structuredData: validator.parse(value), provider: this.name, model: this.model };
  }
}

async function makeUser(label: string) { const id = randomUUID(); const [record] = await db.insert(users).values({ id, email: `${label}-${id}@test.dev`, normalizedEmail: `${label}-${id}@test.dev`, displayName: label }).returning(); return record!; }
async function setup() {
  const owner = await makeUser("owner");
  const workspace = await new WorkspaceService().create(owner.id, { name: "Workspace" });
  const project = await new ProjectService().create(owner.id, { workspaceId: workspace.id, name: "Site" });
  const home = await new PageTreeService().create(owner.id, { projectId: project.id, type: "page", name: "Home" });
  return { owner, project, home };
}
type Selection = { canvasId: string };
async function runPageJob(userId: string, projectId: string, pageId: string, content: string, source: string, options: FixtureOptions & { selection?: Selection } = {}) {
  const { selection, ...fixture } = options;
  const request = await new GenerationJobService().createPageJob(userId, { projectId, pageId, content, selectedMediaIds: [], selection: selection ?? null });
  await claimGenerationJob("worker");
  const job = await new AIOrchestrationService(db, undefined, undefined, fixtureProviderResolver(() => new FixtureProvider(source, fixture))).process(request.job.id);
  if (job?.status !== "completed") throw new Error(`page job failed: ${job?.status} ${job?.errorCode}`);
  return job;
}
async function runBlockJob(userId: string, projectId: string, blockId: string, content: string, source: string, options: FixtureOptions & { selection?: Selection } = {}) {
  const { selection, ...fixture } = options;
  const request = await new GenerationJobService().createBlockJob(userId, { projectId, blockId, content, selectedMediaIds: [], selection: selection ?? null });
  await claimGenerationJob("worker");
  const job = await new AIOrchestrationService(db, undefined, undefined, fixtureProviderResolver(() => new FixtureProvider(source, fixture))).process(request.job.id);
  if (job?.status !== "completed") throw new Error(`block job failed: ${job?.status} ${job?.errorCode}`);
  return job;
}
async function activePageVersion(pageId: string) {
  const [node] = await db.select().from(pageNodes).where(eq(pageNodes.id, pageId));
  if (!node?.currentVersionId) return null;
  const [version] = await db.select().from(pageVersions).where(eq(pageVersions.id, node.currentVersionId));
  return version ?? null;
}
async function activeBlockVersion(blockId: string) {
  const [block] = await db.select().from(buildingBlocks).where(eq(buildingBlocks.id, blockId));
  if (!block?.currentVersionId) return null;
  const [version] = await db.select().from(buildingBlockVersions).where(eq(buildingBlockVersions.id, block.currentVersionId));
  return version ?? null;
}
async function renderedPage(projectId: string, pageId: string) {
  const [node] = await db.select().from(pageNodes).where(eq(pageNodes.id, pageId));
  return node?.currentVersionId ? (await new GeneratedPageContentProvider().get(projectId, pageId, node.currentVersionId))?.bundle ?? "" : "";
}

describe.sequential("Phase 11 versioning, undo/redo, and checkpoints", () => {
  process.env.PREVIEW_TOKEN_SECRET = "phase-eleven-test-preview-secret-value";
  beforeEach(async () => { await sql`TRUNCATE TABLE project_checkpoint_items, project_checkpoints, change_set_items, change_sets, building_block_usages, building_block_versions, building_blocks, generation_job_media, page_versions, ai_job_rate_limits, generation_jobs, ai_messages, ai_conversations, project_instructions, media_assets, media_folders, page_nodes, audit_events, editing_leases, project_invites, project_members, auth_rate_limits, sessions, auth_credentials, projects, workspaces, users RESTART IDENTITY CASCADE`; });
  afterAll(async () => { await sql.end(); });

  it("records a linked Change Set for every AI page and block commit", async () => {
    const { owner, project, home } = await setup();
    const block = await new BuildingBlockService().create(owner.id, { projectId: project.id, name: "Navbar", kind: "navbar", isGlobal: true });
    const pageJob = await runPageJob(owner.id, project.id, home.id, "Create", pageV1);
    await runBlockJob(owner.id, project.id, block.id, "Create", navbarV1);

    const sets = await db.select().from(changeSets).orderBy(changeSets.sequence);
    expect(sets.map((set) => set.operation)).toEqual(["page_generate", "block_generate"]);
    expect(sets.every((set) => set.reversible)).toBe(true);
    const items = await db.select().from(changeSetItems);
    expect(items).toHaveLength(2);
    expect(items.find((item) => item.entityType === "page")).toMatchObject({ entityId: home.id, beforeVersionId: null, afterVersionId: (await activePageVersion(home.id))!.id });
    // Versions and jobs both point at the Change Set that produced them.
    expect((await activePageVersion(home.id))?.changeSetId).toBe(sets[0]!.id);
    expect((await db.select().from(generationJobs).where(eq(generationJobs.id, pageJob.id)))[0]?.resultChangeSetId).toBe(sets[0]!.id);
  });

  it("undoes and redoes a page modification and refreshes the Preview", async () => {
    const { owner, project, home } = await setup();
    await runPageJob(owner.id, project.id, home.id, "Create", pageV1);
    const v1 = (await activePageVersion(home.id))!;
    await runPageJob(owner.id, project.id, home.id, "Compact it", pageV2);
    const v2 = (await activePageVersion(home.id))!;
    const history = new HistoryService();
    const beforeRevision = (await new PreviewManifestService().createSession(owner.id, project.id)).manifest.previewRevision;

    expect((await history.state(owner.id, project.id)).undo).toMatchObject({ operation: "page_modify" });
    await history.undo(owner.id, project.id);
    expect((await activePageVersion(home.id))!.id).toBe(v1.id);
    expect(await renderedPage(project.id, home.id)).toContain("Spacious card");
    // Immutable versions survive an Undo; only the active pointer moved.
    expect(await db.select().from(pageVersions)).toHaveLength(2);
    const afterUndoRevision = (await new PreviewManifestService().createSession(owner.id, project.id)).manifest.previewRevision;
    expect(afterUndoRevision).not.toBe(beforeRevision);

    const state = await history.state(owner.id, project.id);
    expect(state.redo).toMatchObject({ operation: "page_modify" });
    await history.redo(owner.id, project.id);
    expect((await activePageVersion(home.id))!.id).toBe(v2.id);
    expect(await renderedPage(project.id, home.id)).toContain("Compact card");
    expect((await new PreviewManifestService().createSession(owner.id, project.id)).manifest.previewRevision).toBe(beforeRevision);
    expect((await db.select().from(changeSets)).filter((set) => ["undo", "redo"].includes(set.operation))).toHaveLength(2);
  });

  it("undoes a targeted element edit back to the previous version", async () => {
    const { owner, project, home } = await setup();
    await runPageJob(owner.id, project.id, home.id, "Create", pageV1);
    await runPageJob(owner.id, project.id, home.id, "Make this card more compact", pageV2, { selection: { canvasId: "pricing-card" }, targetCanvasId: "pricing-card" });
    expect((await activePageVersion(home.id))!.sourceCode).toBe(pageV2);

    await new HistoryService().undo(owner.id, project.id);
    const restored = (await activePageVersion(home.id))!;
    expect(restored.sourceCode).toBe(pageV1);
    expect(restored.versionNumber).toBe(1);
  });

  it("undoes a global Building Block change for every page that uses it", async () => {
    const { owner, project, home } = await setup();
    const about = await new PageTreeService().create(owner.id, { projectId: project.id, type: "page", name: "About" });
    const navbar = await new BuildingBlockService().create(owner.id, { projectId: project.id, name: "Global Navbar", kind: "navbar", isGlobal: true });
    await runBlockJob(owner.id, project.id, navbar.id, "Create", navbarV1);
    const usage = [{ blockId: navbar.id, usageKey: "site-navbar" }];
    for (const target of [home, about]) await runPageJob(owner.id, project.id, target.id, "Use navbar", usingNavbar(navbar.id), { blockUsages: usage });
    await runBlockJob(owner.id, project.id, navbar.id, "Update navbar", navbarV2);
    for (const target of [home, about]) expect(await renderedPage(project.id, target.id)).toContain("Navbar version two");
    const pageVersionCount = (await db.select().from(pageVersions)).length;

    await new HistoryService().undo(owner.id, project.id);
    for (const target of [home, about]) {
      expect(await renderedPage(project.id, target.id)).toContain("Navbar version one");
      expect(await renderedPage(project.id, target.id)).not.toContain("Navbar version two");
    }
    // Propagation runs through the shared block pointer: no page was rewritten.
    expect((await db.select().from(pageVersions)).length).toBe(pageVersionCount);
    expect((await db.select().from(buildingBlockVersions)).length).toBe(2);
  });

  it("undoes and redoes Building Block generation and global toggles", async () => {
    const { owner, project } = await setup();
    const blocks = new BuildingBlockService();
    const card = await blocks.create(owner.id, { projectId: project.id, name: "Card", kind: "card" });
    await runBlockJob(owner.id, project.id, card.id, "Create", navbarV1);
    const v1 = (await activeBlockVersion(card.id))!;
    await runBlockJob(owner.id, project.id, card.id, "Update", navbarV2);
    const history = new HistoryService();

    await history.undo(owner.id, project.id);
    expect((await activeBlockVersion(card.id))!.id).toBe(v1.id);
    await history.redo(owner.id, project.id);
    expect((await activeBlockVersion(card.id))!.sourceCode).toBe(navbarV2);

    await blocks.setGlobal(owner.id, { projectId: project.id, blockId: card.id, isGlobal: true });
    expect((await history.state(owner.id, project.id)).undo).toMatchObject({ operation: "block_global_toggle" });
    await history.undo(owner.id, project.id);
    expect((await db.select().from(buildingBlocks).where(eq(buildingBlocks.id, card.id)))[0]?.isGlobal).toBe(false);
  });

  it("invalidates Redo once newer work lands", async () => {
    const { owner, project, home } = await setup();
    await runPageJob(owner.id, project.id, home.id, "Create", pageV1);
    await runPageJob(owner.id, project.id, home.id, "Compact", pageV2);
    const history = new HistoryService();
    await history.undo(owner.id, project.id);
    expect((await history.state(owner.id, project.id)).redo).not.toBeNull();

    await runPageJob(owner.id, project.id, home.id, "Different direction", pageV3);
    expect((await history.state(owner.id, project.id)).redo).toBeNull();
    await expect(history.redo(owner.id, project.id)).rejects.toMatchObject({ historyCode: "NOTHING_TO_REDO" });
    expect((await activePageVersion(home.id))!.sourceCode).toBe(pageV3);
  });

  it("refuses to undo over newer collaborator work", async () => {
    const { owner, project, home } = await setup();
    const collaborator = await makeUser("collaborator");
    await db.insert(projectMembers).values({ projectId: project.id, userId: collaborator.id }).onConflictDoNothing();
    await runPageJob(owner.id, project.id, home.id, "Create", pageV1);
    await runPageJob(owner.id, project.id, home.id, "Compact", pageV2);

    // A collaborator activates newer work outside this Change Set's expected state.
    const [newer] = await db.insert(pageVersions).values({ projectId: project.id, pageId: home.id, versionNumber: 3, sourceCode: pageV3, manifest: { editableElements: [] }, seoMetadata: {}, changeSummary: {}, sourceHash: "c".repeat(64), createdByUserId: collaborator.id }).returning();
    await db.update(pageNodes).set({ currentVersionId: newer!.id }).where(eq(pageNodes.id, home.id));

    await expect(new HistoryService().undo(owner.id, project.id)).rejects.toMatchObject({ historyCode: "UNDO_CONFLICT" });
    expect((await activePageVersion(home.id))!.id).toBe(newer!.id);
    expect((await db.select().from(changeSets)).filter((set) => set.operation === "undo")).toHaveLength(0);
  });

  it("refuses to undo work on a page a collaborator deleted", async () => {
    const { owner, project, home } = await setup();
    const second = await new PageTreeService().create(owner.id, { projectId: project.id, type: "page", name: "About" });
    await runPageJob(owner.id, project.id, home.id, "Create home", pageV1);
    await runPageJob(owner.id, project.id, second.id, "Create about", pageV1);
    await new PageTreeService().deleteSubtree(owner.id, { projectId: project.id, nodeId: second.id });
    await expect(new HistoryService().undo(owner.id, project.id)).rejects.toMatchObject({ historyCode: "UNDO_CONFLICT" });
  });

  it("restores an older Page Version while keeping every newer version", async () => {
    const { owner, project, home } = await setup();
    await runPageJob(owner.id, project.id, home.id, "Create", pageV1);
    const v1 = (await activePageVersion(home.id))!;
    await runPageJob(owner.id, project.id, home.id, "Compact", pageV2);
    const v2 = (await activePageVersion(home.id))!;
    const versions = new VersionRestoreService();

    const listed = await versions.listPageVersions(owner.id, project.id, home.id);
    expect(listed.versions.map((version) => version.versionNumber)).toEqual([2, 1]);
    expect(listed.versions[0]).toMatchObject({ isCurrent: true, actor: "owner", summary: "Applied the change" });

    await versions.restorePageVersion(owner.id, project.id, home.id, v1.id);
    expect((await activePageVersion(home.id))!.id).toBe(v1.id);
    expect((await db.select().from(pageVersions)).map((version) => version.id).sort()).toEqual([v1.id, v2.id].sort());
    expect(await renderedPage(project.id, home.id)).toContain("Spacious card");
    expect((await db.select().from(changeSets)).at(-1)).toMatchObject({ operation: "page_version_restore" });

    // The restore is itself reversible.
    await new HistoryService().undo(owner.id, project.id);
    expect((await activePageVersion(home.id))!.id).toBe(v2.id);
  });

  it("restores an older Building Block Version and propagates it to page usages", async () => {
    const { owner, project, home } = await setup();
    const navbar = await new BuildingBlockService().create(owner.id, { projectId: project.id, name: "Global Navbar", kind: "navbar", isGlobal: true });
    await runBlockJob(owner.id, project.id, navbar.id, "Create", navbarV1);
    const blockV1 = (await activeBlockVersion(navbar.id))!;
    await runPageJob(owner.id, project.id, home.id, "Use navbar", usingNavbar(navbar.id), { blockUsages: [{ blockId: navbar.id, usageKey: "site-navbar" }] });
    await runBlockJob(owner.id, project.id, navbar.id, "Update", navbarV2);

    await new VersionRestoreService().restoreBlockVersion(owner.id, project.id, navbar.id, blockV1.id);
    expect((await activeBlockVersion(navbar.id))!.id).toBe(blockV1.id);
    expect(await renderedPage(project.id, home.id)).toContain("Navbar version one");
    expect(await db.select().from(buildingBlockVersions)).toHaveLength(2);
  });

  it("rejects version IDs from another page, block, or project", async () => {
    const { owner, project, home } = await setup();
    const about = await new PageTreeService().create(owner.id, { projectId: project.id, type: "page", name: "About" });
    await runPageJob(owner.id, project.id, home.id, "Create home", pageV1);
    await runPageJob(owner.id, project.id, about.id, "Create about", pageV2);
    const aboutVersion = (await activePageVersion(about.id))!;

    const stranger = await makeUser("stranger");
    const otherWorkspace = await new WorkspaceService().create(stranger.id, { name: "Other" });
    const otherProject = await new ProjectService().create(stranger.id, { workspaceId: otherWorkspace.id, name: "Other Site" });
    const otherHome = await new PageTreeService().create(stranger.id, { projectId: otherProject.id, type: "page", name: "Home" });
    await runPageJob(stranger.id, otherProject.id, otherHome.id, "Create", pageV1);
    const foreignVersion = (await activePageVersion(otherHome.id))!;
    const versions = new VersionRestoreService();

    await expect(versions.restorePageVersion(owner.id, project.id, home.id, aboutVersion.id)).rejects.toMatchObject({ historyCode: "VERSION_NOT_FOUND" });
    await expect(versions.restorePageVersion(owner.id, project.id, home.id, foreignVersion.id)).rejects.toMatchObject({ historyCode: "VERSION_NOT_FOUND" });
    await expect(versions.listPageVersions(stranger.id, project.id, home.id)).rejects.toThrow(/do not have access/);
    await expect(versions.restorePageVersion(stranger.id, project.id, home.id, aboutVersion.id)).rejects.toThrow(/do not have access/);
  });

  it("leaves everything unchanged when a historical version can no longer be validated", async () => {
    const { owner, project, home } = await setup();
    const [asset] = await db.insert(mediaAssets).values({ projectId: project.id, originalFilename: "logo.png", displayName: "Logo", storageKey: `smoke/${randomUUID()}.png`, mimeType: "image/png", sizeBytes: 128, width: 64, height: 64, createdByUserId: owner.id }).returning();
    // The project logo is always part of the AI context, so the page may reference it.
    await db.update(projectBrandSettings).set({ primaryLogoMediaId: asset!.id }).where(eq(projectBrandSettings.projectId, project.id));
    const withMedia = `import { CanvasImage } from "@canvas/site-runtime";\nexport default function Page(){return <main className="c-page"><CanvasImage mediaId="${asset!.id}" alt="Logo" />${HERO}</main>}`;
    await runPageJob(owner.id, project.id, home.id, "Create", withMedia, { referencedMediaIds: [asset!.id] });
    const v1 = (await activePageVersion(home.id))!;
    await runPageJob(owner.id, project.id, home.id, "Drop the logo", pageV2);
    const v2 = (await activePageVersion(home.id))!;
    await db.update(mediaAssets).set({ deletedAt: new Date() }).where(eq(mediaAssets.id, asset!.id));

    await expect(new VersionRestoreService().restorePageVersion(owner.id, project.id, home.id, v1.id)).rejects.toMatchObject({ historyCode: "RESTORE_INVALID" });
    expect((await activePageVersion(home.id))!.id).toBe(v2.id);
    expect((await db.select().from(changeSets)).filter((set) => set.operation === "page_version_restore")).toHaveLength(0);
    // Undo of the modification hits the same validation and also leaves state intact.
    await expect(new HistoryService().undo(owner.id, project.id)).rejects.toMatchObject({ historyCode: "RESTORE_INVALID" });
    expect((await activePageVersion(home.id))!.id).toBe(v2.id);
  });

  it("creates a checkpoint and restores multiple pages, blocks, and global usages in one Change Set", async () => {
    const { owner, project, home } = await setup();
    const about = await new PageTreeService().create(owner.id, { projectId: project.id, type: "page", name: "About" });
    const navbar = await new BuildingBlockService().create(owner.id, { projectId: project.id, name: "Global Navbar", kind: "navbar", isGlobal: true });
    await runBlockJob(owner.id, project.id, navbar.id, "Create", navbarV1);
    const usage = [{ blockId: navbar.id, usageKey: "site-navbar" }];
    await runPageJob(owner.id, project.id, home.id, "Use navbar", usingNavbar(navbar.id), { blockUsages: usage });
    await runPageJob(owner.id, project.id, about.id, "Create about", pageV1);
    const checkpoints = new CheckpointService();
    const checkpoint = await checkpoints.create(owner.id, { projectId: project.id, name: "Before rework" });
    const homeAtCheckpoint = (await activePageVersion(home.id))!.id;
    const aboutAtCheckpoint = (await activePageVersion(about.id))!.id;
    const navbarAtCheckpoint = (await activeBlockVersion(navbar.id))!.id;

    await runBlockJob(owner.id, project.id, navbar.id, "Update navbar", navbarV2);
    await runPageJob(owner.id, project.id, about.id, "Rework about", pageV2);
    expect(await renderedPage(project.id, home.id)).toContain("Navbar version two");

    const listed = await checkpoints.list(owner.id, project.id);
    expect(listed[0]).toMatchObject({ name: "Before rework", pageCount: 2, blockCount: 1, actor: "owner" });

    const result = await checkpoints.restore(owner.id, project.id, checkpoint.id);
    expect(result.restored).toEqual({ pages: 1, blocks: 1 });
    expect((await activePageVersion(about.id))!.id).toBe(aboutAtCheckpoint);
    expect((await activePageVersion(home.id))!.id).toBe(homeAtCheckpoint);
    expect((await activeBlockVersion(navbar.id))!.id).toBe(navbarAtCheckpoint);
    expect(await renderedPage(project.id, home.id)).toContain("Navbar version one");
    expect(await renderedPage(project.id, about.id)).toContain("Spacious card");

    // One Change Set covers the whole multi-entity restore, and it is reversible.
    const sets = await db.select().from(changeSets).orderBy(changeSets.sequence);
    const restoreSet = sets.at(-1)!;
    expect(restoreSet).toMatchObject({ operation: "checkpoint_restore", reversible: true });
    const items = await db.select().from(changeSetItems).where(eq(changeSetItems.changeSetId, restoreSet.id));
    expect(items.filter((item) => item.entityType === "page")).toHaveLength(1);
    expect(items.filter((item) => item.entityType === "building_block")).toHaveLength(1);
    expect(items.filter((item) => item.entityType === "project")).toHaveLength(1);
    // Nothing was destroyed: every version created after the checkpoint still exists.
    expect(await db.select().from(pageVersions)).toHaveLength(3);
    expect(await db.select().from(buildingBlockVersions)).toHaveLength(2);

    await new HistoryService().undo(owner.id, project.id);
    expect(await renderedPage(project.id, home.id)).toContain("Navbar version two");
    expect((await activePageVersion(about.id))!.sourceCode).toBe(pageV2);
  });

  it("reconciles Building Block usages after a restore and keeps historical pins", async () => {
    const { owner, project, home } = await setup();
    const card = await new BuildingBlockService().create(owner.id, { projectId: project.id, name: "Card", kind: "card" });
    await runBlockJob(owner.id, project.id, card.id, "Create", navbarV1);
    const blockV1 = (await activeBlockVersion(card.id))!;
    await runPageJob(owner.id, project.id, home.id, "Use card", usingNavbar(card.id), { blockUsages: [{ blockId: card.id, usageKey: "site-navbar" }] });
    const pageWithBlock = (await activePageVersion(home.id))!;
    expect((await db.select().from(buildingBlockUsages))[0]).toMatchObject({ buildingBlockVersionId: blockV1.id });

    await runBlockJob(owner.id, project.id, card.id, "Update", navbarV2);
    await runPageJob(owner.id, project.id, home.id, "Remove the card", pageV1);
    expect(await db.select().from(buildingBlockUsages)).toHaveLength(0);

    await new VersionRestoreService().restorePageVersion(owner.id, project.id, home.id, pageWithBlock.id);
    const usages = await db.select().from(buildingBlockUsages);
    expect(usages).toHaveLength(1);
    // The non-global usage is pinned back to the version the page was built against.
    expect(usages[0]).toMatchObject({ buildingBlockId: card.id, usageKey: "site-navbar", buildingBlockVersionId: blockV1.id });
    expect(await renderedPage(project.id, home.id)).toContain("Navbar version one");
  });

  it("rejects checkpoints from another project and unauthorized actors", async () => {
    const { owner, project, home } = await setup();
    await runPageJob(owner.id, project.id, home.id, "Create", pageV1);
    const checkpoints = new CheckpointService();
    const checkpoint = await checkpoints.create(owner.id, { projectId: project.id, name: "Mine" });

    const stranger = await makeUser("stranger");
    const otherWorkspace = await new WorkspaceService().create(stranger.id, { name: "Other" });
    const otherProject = await new ProjectService().create(stranger.id, { workspaceId: otherWorkspace.id, name: "Other Site" });

    await expect(checkpoints.restore(stranger.id, otherProject.id, checkpoint.id)).rejects.toMatchObject({ historyCode: "CHECKPOINT_NOT_FOUND" });
    await expect(checkpoints.restore(stranger.id, project.id, checkpoint.id)).rejects.toThrow(/do not have access/);
    await expect(checkpoints.list(stranger.id, project.id)).rejects.toThrow(/do not have access/);
    await expect(new HistoryService().undo(stranger.id, project.id)).rejects.toThrow(/do not have access/);
    expect(await db.select().from(projectCheckpoints)).toHaveLength(1);
    expect((await db.select().from(projectCheckpointItems)).length).toBeGreaterThan(0);
  });

  it("keeps checkpoints and Change Set items immutable", async () => {
    const { owner, project, home } = await setup();
    await runPageJob(owner.id, project.id, home.id, "Create", pageV1);
    const checkpoint = await new CheckpointService().create(owner.id, { projectId: project.id, name: "Snapshot" });
    const [item] = await db.select().from(changeSetItems);
    await expect(db.update(projectCheckpoints).set({ name: "Renamed" }).where(eq(projectCheckpoints.id, checkpoint.id))).rejects.toMatchObject({ cause: { code: "55000" } });
    await expect(db.update(projectCheckpointItems).set({ position: 99 }).where(eq(projectCheckpointItems.checkpointId, checkpoint.id))).rejects.toMatchObject({ cause: { code: "55000" } });
    await expect(db.update(changeSetItems).set({ afterVersionId: null }).where(eq(changeSetItems.id, item!.id))).rejects.toMatchObject({ cause: { code: "55000" } });
  });

  it("reports nothing to undo or redo on a fresh project", async () => {
    const { owner, project } = await setup();
    const history = new HistoryService();
    const state = await history.state(owner.id, project.id);
    expect(state).toMatchObject({ undo: null, redo: null, history: [] });
    await expect(history.undo(owner.id, project.id)).rejects.toMatchObject({ historyCode: "NOTHING_TO_UNDO" });
    await expect(history.redo(owner.id, project.id)).rejects.toMatchObject({ historyCode: "NOTHING_TO_REDO" });
  });
});
