import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, sql } from "@/server/db/client";
import { aiConversations, auditEvents, buildingBlockUsages, buildingBlockVersions, buildingBlocks, generationJobs, pageNodes, pageVersions, users } from "@/server/db/schema";
import { WorkspaceService } from "@/domain/workspaces/service";
import { ProjectService } from "@/domain/projects/service";
import { PageTreeService } from "@/domain/pages/service";
import { BuildingBlockService } from "@/domain/blocks/service";
import { BuildingBlockContentProvider } from "@/domain/blocks/preview";
import { GenerationJobService, claimGenerationJob } from "@/domain/ai/job-service";
import { AIOrchestrationService } from "@/domain/ai/orchestration-service";
import type { AIProvider, AIRequest, AIResponse, StructuredValidator } from "@/domain/ai/provider";
import { HistoryService } from "@/domain/history/undo-service";
import { PreviewManifestService } from "@/generated-runtime/manifest/service";
import { GeneratedPageContentProvider } from "@/generated-runtime/preview/generated-page-provider";

const navbarV1 = `export default function Block(){return <nav className="c-container" aria-label="Main"><span>Navbar version one</span></nav>}`;
const navbarV2 = `export default function Block(){return <nav className="c-container" aria-label="Main"><span>Navbar version two</span></nav>}`;
const footerSource = `export default function Block(){return <footer className="c-container"><span>Footer content</span></footer>}`;
const plainPage = `export default function Page(){return <main className="c-page"><h1>Plain page</h1></main>}`;

function pageUsing(usages: Array<{ blockId: string; usageKey: string }>) {
  const references = usages.map((usage) => `<CanvasBlock blockId="${usage.blockId}" usageKey="${usage.usageKey}" />`).join("");
  return `import { CanvasBlock } from "@canvas/site-runtime";\nexport default function Page(){return <main className="c-page">${references}<h1>Page body</h1></main>}`;
}

/** Deterministic provider so Phase 9 behaviour is verified without real AI credentials. */
class FixtureProvider implements AIProvider {
  name = "fixture"; model = "fixture-1";
  constructor(private readonly source: string, private readonly blockUsages: Array<{ blockId: string; usageKey: string }> = []) {}
  async generateText(): Promise<AIResponse> { return { text: "unused", provider: this.name, model: this.model }; }
  async generateStructured<T>(_request: AIRequest, validator: StructuredValidator<T>): Promise<AIResponse<T>> {
    // Block responses have no blockUsages field: a block may not embed another block.
    const value = { schemaVersion: 1, sourceCode: this.source, referencedMediaIds: [], ...(this.blockUsages.length ? { blockUsages: this.blockUsages } : {}), summary: { headline: "Updated", changes: ["Applied the requested change"], limitations: [] } };
    return { text: JSON.stringify(value), structuredData: validator.parse(value), provider: this.name, model: this.model, usage: { totalTokens: 10 } };
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

/** Runs one block job end to end with a deterministic provider. */
async function runBlockJob(userId: string, projectId: string, blockId: string, content: string, source: string) {
  const request = await new GenerationJobService().createBlockJob(userId, { projectId, blockId, content, selectedMediaIds: [] });
  await claimGenerationJob("worker");
  return { request, job: await new AIOrchestrationService(db, undefined, undefined, () => new FixtureProvider(source)).process(request.job.id) };
}
async function runPageJob(userId: string, projectId: string, pageId: string, content: string, source: string, blockUsages: Array<{ blockId: string; usageKey: string }> = []) {
  const request = await new GenerationJobService().createPageJob(userId, { projectId, pageId, content, selectedMediaIds: [] });
  await claimGenerationJob("worker");
  return { request, job: await new AIOrchestrationService(db, undefined, undefined, () => new FixtureProvider(source, blockUsages)).process(request.job.id) };
}

describe.sequential("Phase 9 Building Blocks", () => {
  process.env.PREVIEW_TOKEN_SECRET = "phase-nine-test-preview-secret-value";
  beforeEach(async () => { await sql`TRUNCATE TABLE change_set_items, change_sets, building_block_usages, building_block_versions, building_blocks, generation_job_media, page_versions, ai_job_rate_limits, generation_jobs, ai_messages, ai_conversations, project_instructions, media_assets, media_folders, page_nodes, audit_events, editing_leases, project_invites, project_members, auth_rate_limits, sessions, auth_credentials, projects, workspaces, users RESTART IDENTITY CASCADE`; });
  afterAll(async () => { await sql.end(); });

  it("creates a validated active Block Version and previews it", async () => {
    const { owner, project } = await setup();
    const blocks = new BuildingBlockService();
    const navbar = await blocks.create(owner.id, { projectId: project.id, name: "Global Navbar", kind: "navbar", isGlobal: true });
    expect(navbar.currentVersionId).toBeNull();

    const { job } = await runBlockJob(owner.id, project.id, navbar.id, "Create a navbar", navbarV1);
    expect(job).toMatchObject({ status: "completed", operation: "block_generate" });
    const versions = await db.select().from(buildingBlockVersions);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ versionNumber: 1, sourceCode: navbarV1 });
    const [stored] = await db.select().from(buildingBlocks).where(eq(buildingBlocks.id, navbar.id));
    expect(stored?.currentVersionId).toBe(versions[0]!.id);

    const compiled = await new BuildingBlockContentProvider().getActive(project.id, navbar.id);
    expect(compiled?.bundle).toContain("Navbar version one");
    const manifest = (await new PreviewManifestService().createSession(owner.id, project.id)).manifest;
    expect(manifest.blocks[navbar.id]).toMatchObject({ isGlobal: true, contentStatus: "generated", activeVersionId: versions[0]!.id });
  });

  it("modifies a block into a new version while the previous version stays intact", async () => {
    const { owner, project } = await setup();
    const navbar = await new BuildingBlockService().create(owner.id, { projectId: project.id, name: "Navbar", kind: "navbar" });
    await runBlockJob(owner.id, project.id, navbar.id, "Create", navbarV1);
    const [v1] = await db.select().from(buildingBlockVersions);

    const { job } = await runBlockJob(owner.id, project.id, navbar.id, "Tighten it", navbarV2);
    expect(job).toMatchObject({ status: "completed", operation: "block_modify", baseBlockVersionId: v1!.id });
    const versions = await db.select().from(buildingBlockVersions);
    expect(versions.map((version) => version.versionNumber).sort()).toEqual([1, 2]);
    expect(versions.find((version) => version.id === v1!.id)?.sourceCode).toBe(navbarV1);
    const [stored] = await db.select().from(buildingBlocks).where(eq(buildingBlocks.id, navbar.id));
    expect(stored?.currentVersionId).toBe(versions.find((version) => version.versionNumber === 2)!.id);
  });

  it("never activates unsafe, cancelled, or stale block output", async () => {
    const { owner, project } = await setup();
    const blocks = new BuildingBlockService();
    const navbar = await blocks.create(owner.id, { projectId: project.id, name: "Navbar", kind: "navbar" });
    await runBlockJob(owner.id, project.id, navbar.id, "Create", navbarV1);
    const [v1] = await db.select().from(buildingBlockVersions);

    const unsafe = await runBlockJob(owner.id, project.id, navbar.id, "Add tracking", `export default function Block(){fetch("/api/track");return <nav/>}`);
    expect(unsafe.job).toMatchObject({ status: "failed", errorCode: "AI_PROVIDER_INVALID_RESPONSE" });
    expect(await db.select().from(buildingBlockVersions)).toHaveLength(1);
    expect((await db.select().from(buildingBlocks).where(eq(buildingBlocks.id, navbar.id)))[0]?.currentVersionId).toBe(v1!.id);

    const cancelled = await new GenerationJobService().createBlockJob(owner.id, { projectId: project.id, blockId: navbar.id, content: "Cancel me", selectedMediaIds: [] });
    await new GenerationJobService().requestCancellation(owner.id, project.id, cancelled.job.id);
    await new AIOrchestrationService(db, undefined, undefined, () => new FixtureProvider(navbarV2)).process(cancelled.job.id);
    expect(await db.select().from(buildingBlockVersions)).toHaveLength(1);

    // A job that started from v1 cannot overwrite a newer active version.
    const stale = await new GenerationJobService().createBlockJob(owner.id, { projectId: project.id, blockId: navbar.id, content: "Slow job", selectedMediaIds: [] });
    await claimGenerationJob("worker");
    const [v2] = await db.insert(buildingBlockVersions).values({ projectId: project.id, buildingBlockId: navbar.id, versionNumber: 2, sourceCode: navbarV2, manifest: {}, sourceHash: "b".repeat(64), createdByUserId: owner.id }).returning();
    await db.update(buildingBlocks).set({ currentVersionId: v2!.id }).where(eq(buildingBlocks.id, navbar.id));
    const staleResult = await new AIOrchestrationService(db, undefined, undefined, () => new FixtureProvider(navbarV1)).process(stale.job.id);
    expect(staleResult).toMatchObject({ status: "failed", errorCode: "AI_BLOCK_STALE" });
    expect((await db.select().from(buildingBlocks).where(eq(buildingBlocks.id, navbar.id)))[0]?.currentVersionId).toBe(v2!.id);
  });

  it("allows only one active AI job per block while other blocks stay free", async () => {
    const { owner, project } = await setup();
    const blocks = new BuildingBlockService();
    const navbar = await blocks.create(owner.id, { projectId: project.id, name: "Navbar", kind: "navbar" });
    const footer = await blocks.create(owner.id, { projectId: project.id, name: "Footer", kind: "footer" });
    const jobs = new GenerationJobService();
    await jobs.createBlockJob(owner.id, { projectId: project.id, blockId: navbar.id, content: "One", selectedMediaIds: [] });
    await expect(jobs.createBlockJob(owner.id, { projectId: project.id, blockId: navbar.id, content: "Two", selectedMediaIds: [] })).rejects.toThrow(/already updating/);
    await expect(jobs.createBlockJob(owner.id, { projectId: project.id, blockId: footer.id, content: "Footer", selectedMediaIds: [] })).resolves.toBeDefined();
  });

  it("duplicates a block into an independent block with its own version history", async () => {
    const { owner, project } = await setup();
    const blocks = new BuildingBlockService();
    const navbar = await blocks.create(owner.id, { projectId: project.id, name: "Global Navbar", kind: "navbar", isGlobal: true });
    await runBlockJob(owner.id, project.id, navbar.id, "Create", navbarV1);

    const copy = await blocks.duplicate(owner.id, { projectId: project.id, blockId: navbar.id });
    expect(copy.id).not.toBe(navbar.id);
    expect(copy).toMatchObject({ name: "Global Navbar Copy", kind: "navbar", isGlobal: true });
    const copyVersions = await db.select().from(buildingBlockVersions).where(eq(buildingBlockVersions.buildingBlockId, copy.id));
    expect(copyVersions).toHaveLength(1);
    expect(copyVersions[0]).toMatchObject({ versionNumber: 1, sourceCode: navbarV1 });
    expect(copyVersions[0]!.id).not.toBe((await db.select().from(buildingBlockVersions).where(eq(buildingBlockVersions.buildingBlockId, navbar.id)))[0]!.id);

    await runBlockJob(owner.id, project.id, navbar.id, "Change the original", navbarV2);
    const [storedCopy] = await db.select().from(buildingBlocks).where(eq(buildingBlocks.id, copy.id));
    expect(storedCopy?.currentVersionId).toBe(copyVersions[0]!.id);
    expect((await db.select().from(buildingBlockVersions).where(eq(buildingBlockVersions.id, copyVersions[0]!.id)))[0]?.sourceCode).toBe(navbarV1);
  });

  it("propagates a global block change to every page usage without new Page Versions", async () => {
    const { owner, project, home } = await setup();
    const about = await new PageTreeService().create(owner.id, { projectId: project.id, type: "page", name: "About" });
    const navbar = await new BuildingBlockService().create(owner.id, { projectId: project.id, name: "Global Navbar", kind: "navbar", isGlobal: true });
    await runBlockJob(owner.id, project.id, navbar.id, "Create the navbar", navbarV1);

    const usage = [{ blockId: navbar.id, usageKey: "site-navbar" }];
    await runPageJob(owner.id, project.id, home.id, "Use the existing navbar", pageUsing(usage), usage);
    await runPageJob(owner.id, project.id, about.id, "Use the same navbar", pageUsing(usage), usage);

    // Pages reference the stable block UUID rather than cloning its markup.
    const pageSources = (await db.select().from(pageVersions)).map((version) => version.sourceCode);
    expect(pageSources).toHaveLength(2);
    for (const source of pageSources) { expect(source).toContain(navbar.id); expect(source).not.toContain("Navbar version one"); }
    const usages = await db.select().from(buildingBlockUsages);
    expect(usages).toHaveLength(2);
    expect(usages.every((row) => row.buildingBlockVersionId === null)).toBe(true);

    const provider = new GeneratedPageContentProvider();
    const homeBefore = await provider.get(project.id, home.id, (await db.select().from(pageNodes).where(eq(pageNodes.id, home.id)))[0]!.currentVersionId!);
    expect(homeBefore?.bundle).toContain("Navbar version one");

    await runBlockJob(owner.id, project.id, navbar.id, "Update the navbar", navbarV2);

    const pageVersionCount = (await db.select().from(pageVersions)).length;
    expect(pageVersionCount).toBe(2);
    for (const pageId of [home.id, about.id]) {
      const [node] = await db.select().from(pageNodes).where(eq(pageNodes.id, pageId));
      const rendered = await provider.get(project.id, pageId, node!.currentVersionId!);
      expect(rendered?.bundle).toContain("Navbar version two");
      expect(rendered?.bundle).not.toContain("Navbar version one");
    }
    expect((await db.select().from(buildingBlockUsages)).every((row) => row.buildingBlockVersionId === null)).toBe(true);
  });

  it("pins non-global block usages so later block changes do not alter the page", async () => {
    const { owner, project, home } = await setup();
    const card = await new BuildingBlockService().create(owner.id, { projectId: project.id, name: "Product Card", kind: "card" });
    await runBlockJob(owner.id, project.id, card.id, "Create", navbarV1);
    const usage = [{ blockId: card.id, usageKey: "product-card" }];
    await runPageJob(owner.id, project.id, home.id, "Use the card", pageUsing(usage), usage);

    const [pinned] = await db.select().from(buildingBlockUsages);
    const [v1] = await db.select().from(buildingBlockVersions);
    expect(pinned?.buildingBlockVersionId).toBe(v1!.id);

    await runBlockJob(owner.id, project.id, card.id, "Change it", navbarV2);
    const [node] = await db.select().from(pageNodes).where(eq(pageNodes.id, home.id));
    const rendered = await new GeneratedPageContentProvider().get(project.id, home.id, node!.currentVersionId!);
    expect(rendered?.bundle).toContain("Navbar version one");
    expect(rendered?.bundle).not.toContain("Navbar version two");
  });

  it("reconciles active usage rows when a page moves from one block to another", async () => {
    const { owner, project, home } = await setup();
    const blocks = new BuildingBlockService();
    const navbar = await blocks.create(owner.id, { projectId: project.id, name: "Navbar", kind: "navbar", isGlobal: true });
    const footer = await blocks.create(owner.id, { projectId: project.id, name: "Footer", kind: "footer", isGlobal: true });
    await runBlockJob(owner.id, project.id, navbar.id, "Create", navbarV1);
    await runBlockJob(owner.id, project.id, footer.id, "Create", footerSource);

    await runPageJob(owner.id, project.id, home.id, "Use navbar", pageUsing([{ blockId: navbar.id, usageKey: "site-navbar" }]), [{ blockId: navbar.id, usageKey: "site-navbar" }]);
    expect((await db.select().from(buildingBlockUsages)).map((row) => row.buildingBlockId)).toEqual([navbar.id]);

    await runPageJob(owner.id, project.id, home.id, "Swap to footer", pageUsing([{ blockId: footer.id, usageKey: "site-footer" }]), [{ blockId: footer.id, usageKey: "site-footer" }]);
    const usages = await db.select().from(buildingBlockUsages);
    expect(usages).toHaveLength(1);
    expect(usages[0]).toMatchObject({ buildingBlockId: footer.id, usageKey: "site-footer" });
  });

  it("rejects hallucinated, foreign, and archived block references without changing the active page", async () => {
    const { owner, project, home } = await setup();
    const blocks = new BuildingBlockService();
    await runPageJob(owner.id, project.id, home.id, "Create the page", plainPage);
    const [baseline] = await db.select().from(pageVersions);

    const hallucinated = [{ blockId: randomUUID(), usageKey: "nav" }];
    const invalid = await runPageJob(owner.id, project.id, home.id, "Add a navbar", pageUsing(hallucinated), hallucinated);
    expect(invalid.job).toMatchObject({ status: "failed", errorCode: "AI_PROVIDER_INVALID_RESPONSE" });

    const stranger = await makeUser("stranger");
    const otherWorkspace = await new WorkspaceService().create(stranger.id, { name: "Other" });
    const otherProject = await new ProjectService().create(stranger.id, { workspaceId: otherWorkspace.id, name: "Other Site" });
    const foreignBlock = await blocks.create(stranger.id, { projectId: otherProject.id, name: "Navbar", kind: "navbar", isGlobal: true });
    await runBlockJob(stranger.id, otherProject.id, foreignBlock.id, "Create", navbarV1);
    const foreignUsage = [{ blockId: foreignBlock.id, usageKey: "nav" }];
    const crossProject = await runPageJob(owner.id, project.id, home.id, "Use their navbar", pageUsing(foreignUsage), foreignUsage);
    expect(crossProject.job).toMatchObject({ status: "failed", errorCode: "AI_PROVIDER_INVALID_RESPONSE" });

    const archived = await blocks.create(owner.id, { projectId: project.id, name: "Old Hero", kind: "hero" });
    await blocks.archive(owner.id, { projectId: project.id, blockId: archived.id });
    const archivedUsage = [{ blockId: archived.id, usageKey: "hero" }];
    const archivedResult = await runPageJob(owner.id, project.id, home.id, "Use the archived hero", pageUsing(archivedUsage), archivedUsage);
    expect(archivedResult.job).toMatchObject({ status: "failed", errorCode: "AI_PROVIDER_INVALID_RESPONSE" });

    const [current] = await db.select().from(pageNodes).where(eq(pageNodes.id, home.id));
    expect(current?.currentVersionId).toBe(baseline!.id);
    expect(await db.select().from(buildingBlockUsages)).toHaveLength(0);
  });

  it("converts global status in both directions while keeping existing pages deterministic", async () => {
    const { owner, project, home } = await setup();
    const blocks = new BuildingBlockService();
    const navbar = await blocks.create(owner.id, { projectId: project.id, name: "Navbar", kind: "navbar" });
    await runBlockJob(owner.id, project.id, navbar.id, "Create", navbarV1);
    const usage = [{ blockId: navbar.id, usageKey: "site-navbar" }];
    await runPageJob(owner.id, project.id, home.id, "Use the navbar", pageUsing(usage), usage);
    const [v1] = await db.select().from(buildingBlockVersions);
    expect((await db.select().from(buildingBlockUsages))[0]?.buildingBlockVersionId).toBe(v1!.id);

    await blocks.setGlobal(owner.id, { projectId: project.id, blockId: navbar.id, isGlobal: true });
    expect((await db.select().from(buildingBlockUsages))[0]?.buildingBlockVersionId).toBeNull();
    await runBlockJob(owner.id, project.id, navbar.id, "Update", navbarV2);
    const [node] = await db.select().from(pageNodes).where(eq(pageNodes.id, home.id));
    expect((await new GeneratedPageContentProvider().get(project.id, home.id, node!.currentVersionId!))?.bundle).toContain("Navbar version two");

    await blocks.setGlobal(owner.id, { projectId: project.id, blockId: navbar.id, isGlobal: false });
    const [v2] = await db.select().from(buildingBlockVersions).where(eq(buildingBlockVersions.versionNumber, 2));
    expect((await db.select().from(buildingBlockUsages))[0]?.buildingBlockVersionId).toBe(v2!.id);
    expect((await new GeneratedPageContentProvider().get(project.id, home.id, node!.currentVersionId!))?.bundle).toContain("Navbar version two");
  });

  it("attaches and detaches one page's copy of a shared block without touching the others", async () => {
    const { owner, project, home } = await setup();
    const blocks = new BuildingBlockService();
    const about = await new PageTreeService().create(owner.id, { projectId: project.id, type: "page", name: "About" });
    const navbar = await blocks.create(owner.id, { projectId: project.id, name: "Navbar", kind: "navbar", isGlobal: true });
    await runBlockJob(owner.id, project.id, navbar.id, "Create", navbarV1);
    const usage = [{ blockId: navbar.id, usageKey: "site-navbar" }];
    for (const page of [home, about]) await runPageJob(owner.id, project.id, page.id, "Use the navbar", pageUsing(usage), usage);
    const [v1] = await db.select().from(buildingBlockVersions);
    const resolutionOf = async (pageId: string) => (await blocks.listUsages(owner.id, project.id, navbar.id)).find((row) => row.pageId === pageId);
    expect(await resolutionOf(home.id)).toMatchObject({ resolution: "global", pinnedVersionId: null });

    // Freezing Home leaves About following the shared section, even though both
    // pages use the same usage key.
    await blocks.setUsageResolution(owner.id, { projectId: project.id, blockId: navbar.id, pageId: home.id, usageKey: "site-navbar", resolution: "pinned" });
    expect(await resolutionOf(home.id)).toMatchObject({ resolution: "pinned", pinnedVersionId: v1!.id });
    expect(await resolutionOf(about.id)).toMatchObject({ resolution: "global", pinnedVersionId: null });

    // A later block change reaches the page still following it, and not the frozen one.
    await runBlockJob(owner.id, project.id, navbar.id, "Update", navbarV2);
    const bundleOf = async (pageId: string) => {
      const [node] = await db.select().from(pageNodes).where(eq(pageNodes.id, pageId));
      return (await new GeneratedPageContentProvider().get(project.id, pageId, node!.currentVersionId!))?.bundle;
    };
    expect(await bundleOf(home.id)).toContain("Navbar version one");
    expect(await bundleOf(about.id)).toContain("Navbar version two");

    // Reattaching brings it back onto the shared version.
    await blocks.setUsageResolution(owner.id, { projectId: project.id, blockId: navbar.id, pageId: home.id, usageKey: "site-navbar", resolution: "global" });
    expect(await resolutionOf(home.id)).toMatchObject({ resolution: "global", pinnedVersionId: null });
    expect(await bundleOf(home.id)).toContain("Navbar version two");
  });

  it("lets a page rebuild reset its own resolution, the way the block-wide toggle does", async () => {
    const { owner, project, home } = await setup();
    const blocks = new BuildingBlockService();
    const navbar = await blocks.create(owner.id, { projectId: project.id, name: "Navbar", kind: "navbar", isGlobal: true });
    await runBlockJob(owner.id, project.id, navbar.id, "Create", navbarV1);
    const usage = [{ blockId: navbar.id, usageKey: "site-navbar" }];
    await runPageJob(owner.id, project.id, home.id, "Use the navbar", pageUsing(usage), usage);
    await blocks.setUsageResolution(owner.id, { projectId: project.id, blockId: navbar.id, pageId: home.id, usageKey: "site-navbar", resolution: "pinned" });
    expect((await blocks.listUsages(owner.id, project.id, navbar.id))[0]).toMatchObject({ resolution: "pinned" });

    // Activating a Page Version rebuilds that page's usage rows from the block's
    // own global flag, so a per-page freeze lasts until the page itself is next
    // rebuilt. This is the same rule the block-wide toggle has always had; it is
    // asserted here so the interaction is a decision on record, not a surprise.
    await runPageJob(owner.id, project.id, home.id, "Tweak the wording", pageUsing(usage), usage);
    expect((await blocks.listUsages(owner.id, project.id, navbar.id))[0]).toMatchObject({ resolution: "global" });
  });

  it("records each per-page attach and detach in project history and the audit log", async () => {
    const { owner, project, home } = await setup();
    const blocks = new BuildingBlockService();
    const navbar = await blocks.create(owner.id, { projectId: project.id, name: "Navbar", kind: "navbar", isGlobal: true });
    await runBlockJob(owner.id, project.id, navbar.id, "Create", navbarV1);
    const usage = [{ blockId: navbar.id, usageKey: "site-navbar" }];
    await runPageJob(owner.id, project.id, home.id, "Use the navbar", pageUsing(usage), usage);

    await blocks.setUsageResolution(owner.id, { projectId: project.id, blockId: navbar.id, pageId: home.id, usageKey: "site-navbar", resolution: "pinned" });
    const state = await new HistoryService().state(owner.id, project.id);
    const entry = state.history.find((item) => item.operation === "block_usage_resolution");
    expect(entry?.summary).toBe("Navbar on Home: frozen at the current version");
    // Undo replays version moves; a usage's resolution is not one, so the entry
    // is recorded for the feed but never becomes the undo candidate.
    expect(entry?.reversible).toBe(false);
    expect(state.undo?.operation).not.toBe("block_usage_resolution");
    expect((await db.select().from(auditEvents).where(eq(auditEvents.action, "block.usage_detached")))).toHaveLength(1);

    await blocks.setUsageResolution(owner.id, { projectId: project.id, blockId: navbar.id, pageId: home.id, usageKey: "site-navbar", resolution: "global" });
    expect((await db.select().from(auditEvents).where(eq(auditEvents.action, "block.usage_attached")))).toHaveLength(1);
    // Asking for the resolution a usage already has changes nothing.
    await blocks.setUsageResolution(owner.id, { projectId: project.id, blockId: navbar.id, pageId: home.id, usageKey: "site-navbar", resolution: "global" });
    expect((await db.select().from(auditEvents).where(eq(auditEvents.action, "block.usage_attached")))).toHaveLength(1);
  });

  it("refuses to change a usage that does not exist, and one with no version to point at", async () => {
    const { owner, project, home } = await setup();
    const blocks = new BuildingBlockService();
    const navbar = await blocks.create(owner.id, { projectId: project.id, name: "Navbar", kind: "navbar", isGlobal: true });
    await runBlockJob(owner.id, project.id, navbar.id, "Create", navbarV1);
    const usage = [{ blockId: navbar.id, usageKey: "site-navbar" }];
    await runPageJob(owner.id, project.id, home.id, "Use the navbar", pageUsing(usage), usage);

    for (const attempt of [
      { pageId: home.id, usageKey: "not-a-usage" },
      { pageId: randomUUID(), usageKey: "site-navbar" },
    ]) {
      await expect(blocks.setUsageResolution(owner.id, { projectId: project.id, blockId: navbar.id, resolution: "pinned", ...attempt }))
        .rejects.toMatchObject({ blockCode: "BLOCK_USAGE_NOT_FOUND" });
    }

    // The same guard the bulk toggle applies: with no active version there is
    // nothing to freeze at, and nothing for a following page to resolve.
    await db.update(buildingBlocks).set({ currentVersionId: null }).where(eq(buildingBlocks.id, navbar.id));
    await expect(blocks.setUsageResolution(owner.id, { projectId: project.id, blockId: navbar.id, pageId: home.id, usageKey: "site-navbar", resolution: "pinned" }))
      .rejects.toMatchObject({ blockCode: "BLOCK_GLOBAL_CONVERSION_FAILED" });
  });

  it("archives unused blocks and refuses to archive a block an active page still uses", async () => {
    const { owner, project, home } = await setup();
    const blocks = new BuildingBlockService();
    const navbar = await blocks.create(owner.id, { projectId: project.id, name: "Navbar", kind: "navbar", isGlobal: true });
    await runBlockJob(owner.id, project.id, navbar.id, "Create", navbarV1);
    const usage = [{ blockId: navbar.id, usageKey: "site-navbar" }];
    await runPageJob(owner.id, project.id, home.id, "Use the navbar", pageUsing(usage), usage);

    await expect(blocks.archive(owner.id, { projectId: project.id, blockId: navbar.id })).rejects.toMatchObject({ blockCode: "BLOCK_IN_USE" });
    await runPageJob(owner.id, project.id, home.id, "Remove the navbar", plainPage);
    await expect(blocks.archive(owner.id, { projectId: project.id, blockId: navbar.id })).resolves.toMatchObject({ deletedAt: expect.any(Date) });
    // Historical versions survive archiving; the block leaves the active library.
    expect(await db.select().from(buildingBlockVersions).where(eq(buildingBlockVersions.buildingBlockId, navbar.id))).toHaveLength(1);
    expect(await blocks.list(owner.id, { projectId: project.id })).toEqual([]);
    await expect(blocks.read(owner.id, project.id, navbar.id)).rejects.toMatchObject({ blockCode: "BLOCK_DELETED" });
  });

  it("keeps block conversations block-scoped and reports usage in the library", async () => {
    const { owner, project, home } = await setup();
    const blocks = new BuildingBlockService();
    const navbar = await blocks.create(owner.id, { projectId: project.id, name: "Navbar", kind: "navbar", isGlobal: true });
    const footer = await blocks.create(owner.id, { projectId: project.id, name: "Footer", kind: "footer" });
    await runBlockJob(owner.id, project.id, navbar.id, "Create the navbar", navbarV1);
    await runBlockJob(owner.id, project.id, footer.id, "Create the footer", footerSource);
    await runPageJob(owner.id, project.id, home.id, "Use the navbar", pageUsing([{ blockId: navbar.id, usageKey: "site-navbar" }]), [{ blockId: navbar.id, usageKey: "site-navbar" }]);

    const conversations = await db.select().from(aiConversations);
    expect(conversations.filter((conversation) => conversation.buildingBlockId === navbar.id)).toHaveLength(1);
    expect(conversations.filter((conversation) => conversation.buildingBlockId === footer.id)).toHaveLength(1);
    const navbarState = await new GenerationJobService().getBlockState(owner.id, project.id, navbar.id);
    expect(navbarState.messages.map((message) => message.content)).toContain("Create the navbar");
    expect(navbarState.messages.map((message) => message.content)).not.toContain("Create the footer");

    const listed = await blocks.list(owner.id, { projectId: project.id });
    expect(listed.find((block) => block.id === navbar.id)).toMatchObject({ usageCount: 1, currentVersionNumber: 1, contentStatus: "generated" });
    expect(listed.find((block) => block.id === footer.id)).toMatchObject({ usageCount: 0 });
    expect(await blocks.listUsages(owner.id, project.id, navbar.id)).toEqual([{ usageKey: "site-navbar", pageId: home.id, pageName: "Home", route: "/", pinnedVersionId: null, resolution: "global" }]);
  });

  it("isolates every block operation from users outside the project", async () => {
    const { owner, project } = await setup();
    const stranger = await makeUser("stranger");
    const blocks = new BuildingBlockService();
    const navbar = await blocks.create(owner.id, { projectId: project.id, name: "Navbar", kind: "navbar" });
    await runBlockJob(owner.id, project.id, navbar.id, "Create", navbarV1);

    for (const attempt of [
      () => blocks.read(stranger.id, project.id, navbar.id),
      () => blocks.list(stranger.id, { projectId: project.id }),
      () => blocks.update(stranger.id, { projectId: project.id, blockId: navbar.id, name: "Hijacked" }),
      () => blocks.setGlobal(stranger.id, { projectId: project.id, blockId: navbar.id, isGlobal: true }),
      () => blocks.duplicate(stranger.id, { projectId: project.id, blockId: navbar.id }),
      () => blocks.archive(stranger.id, { projectId: project.id, blockId: navbar.id }),
      () => blocks.listUsages(stranger.id, project.id, navbar.id),
      () => blocks.setUsageResolution(stranger.id, { projectId: project.id, blockId: navbar.id, pageId: randomUUID(), usageKey: "site-navbar", resolution: "pinned" }),
      () => new GenerationJobService().getBlockState(stranger.id, project.id, navbar.id),
      () => new GenerationJobService().createBlockJob(stranger.id, { projectId: project.id, blockId: navbar.id, content: "Hijack", selectedMediaIds: [] }),
    ]) await expect(attempt()).rejects.toThrow(/do not have access/);

    // A guessed UUID from another project cannot be reached through this project either.
    const otherWorkspace = await new WorkspaceService().create(stranger.id, { name: "Other" });
    const otherProject = await new ProjectService().create(stranger.id, { workspaceId: otherWorkspace.id, name: "Other Site" });
    await expect(blocks.read(stranger.id, otherProject.id, navbar.id)).rejects.toMatchObject({ blockCode: "BLOCK_NOT_FOUND" });
    expect(await new BuildingBlockContentProvider().getActive(otherProject.id, navbar.id)).toBeNull();
    const [job] = await db.select().from(generationJobs).where(and(eq(generationJobs.projectId, project.id), eq(generationJobs.operation, "block_generate")));
    await expect(new GenerationJobService().get(stranger.id, project.id, job!.id)).rejects.toThrow(/do not have access/);
  });
});
