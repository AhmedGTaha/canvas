import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, sql } from "@/server/db/client";
import { aiMessages, buildingBlockVersions, buildingBlocks, generationJobs, pageNodes, pageVersions, users } from "@/server/db/schema";
import { WorkspaceService } from "@/domain/workspaces/service";
import { ProjectService } from "@/domain/projects/service";
import { PageTreeService } from "@/domain/pages/service";
import { BuildingBlockService } from "@/domain/blocks/service";
import { GenerationJobService, claimGenerationJob } from "@/domain/ai/job-service";
import { AIOrchestrationService } from "@/domain/ai/orchestration-service";
import type { AIProvider, AIRequest, AIResponse, StructuredValidator } from "@/domain/ai/provider";
import { GeneratedPageContentProvider } from "@/generated-runtime/preview/generated-page-provider";
import { fixtureProviderResolver } from "@/domain/ai/testing/provider-fixtures";

/** Media as the sandboxed Preview resolves it: a session URL, never a storage key. */
const previewMedia = (id: string) => ({ url: `/api/preview/media/${id}`, width: 40, height: 40, altText: null });


const HERO = `<section data-canvas-id="hero-main" data-canvas-label="Hero"><h1>Original hero</h1></section>`;
const page = (body: string) => `<main data-canvas-id="page" class="c-page">${HERO}${body}</main>`;
const pageV1 = page(`<article data-canvas-id="pricing-card-pro"><h2>Pro plan</h2><p>Spacious pricing card</p></article>`);
const pageCompactCard = page(`<article data-canvas-id="pricing-card-pro"><h2>Pro plan</h2><p>Compact pricing card</p></article>`);
const pageWithoutCard = page(``);
const pageWithoutHero = `<main class="c-page"><article data-canvas-id="pricing-card-pro">Pro</article></main>`;
const navbarV1 = `<nav data-canvas-id="navbar-root" aria-label="Main"><span>Navbar version one</span></nav>`;
const navbarV2 = `<nav data-canvas-id="navbar-root" aria-label="Main"><span>Navbar version two</span></nav>`;
const pageUsingNavbar = (blockId: string) => `<main data-canvas-id="page" class="c-page"><div data-canvas-block="${blockId}" data-canvas-usage="site-navbar"></div>${HERO}</main>`;

type FixtureOptions = { targetCanvasId?: string | null; targetRemoved?: boolean; blockUsages?: Array<{ blockId: string; usageKey: string }>; block?: boolean };

/** Deterministic provider: element targeting is verified without real AI credentials. */
class FixtureProvider implements AIProvider { readonly capabilities = { structuredOutput: true, vision: true };
  name = "fixture"; model = "fixture-1";
  constructor(private readonly source: string, private readonly options: FixtureOptions = {}) {}
  async generateText(): Promise<AIResponse> { return { text: "unused", provider: this.name, model: this.model }; }
  async generateStructured<T>(_request: AIRequest, validator: StructuredValidator<T>): Promise<AIResponse<T>> {
    const value = {
      schemaVersion: 1, html: this.source, referencedMediaIds: [],
      ...(this.options.blockUsages?.length ? { blockUsages: this.options.blockUsages } : {}),
      ...(this.options.targetCanvasId === undefined ? {} : { targetCanvasId: this.options.targetCanvasId }),
      ...(this.options.targetRemoved === undefined ? {} : { targetRemoved: this.options.targetRemoved }),
      summary: { headline: "Updated", changes: ["Applied the requested change"], limitations: [] },
    };
    return { text: JSON.stringify(value), structuredData: validator.parse(value), provider: this.name, model: this.model };
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
type Selection = { canvasId: string; blockId?: string | null; usageKey?: string | null };
async function runPageJob(userId: string, projectId: string, pageId: string, content: string, source: string, options: FixtureOptions & { selection?: Selection } = {}) {
  const { selection, ...fixture } = options;
  const request = await new GenerationJobService().createPageJob(userId, { projectId, pageId, content, selectedMediaIds: [], selection: selection ?? null });
  await claimGenerationJob("worker");
  return { request, job: await new AIOrchestrationService(db, undefined, undefined, fixtureProviderResolver(() => new FixtureProvider(source, fixture))).process(request.job.id) };
}
async function runBlockJob(userId: string, projectId: string, blockId: string, content: string, source: string, options: FixtureOptions & { selection?: Selection } = {}) {
  const { selection, ...fixture } = options;
  const request = await new GenerationJobService().createBlockJob(userId, { projectId, blockId, content, selectedMediaIds: [], selection: selection ?? null });
  await claimGenerationJob("worker");
  return { request, job: await new AIOrchestrationService(db, undefined, undefined, fixtureProviderResolver(() => new FixtureProvider(source, fixture))).process(request.job.id) };
}
async function activeSource(pageId: string) {
  const [node] = await db.select().from(pageNodes).where(eq(pageNodes.id, pageId));
  const [version] = await db.select().from(pageVersions).where(eq(pageVersions.id, node!.currentVersionId!));
  return version!;
}

describe.sequential("Phase 10 element-level editing", () => {
  process.env.PREVIEW_TOKEN_SECRET = "phase-ten-test-preview-secret-value";
  beforeEach(async () => { await sql`TRUNCATE TABLE building_block_usages, building_block_versions, building_blocks, generation_job_media, page_versions, ai_job_rate_limits, generation_jobs, ai_messages, ai_conversations, project_instructions, media_assets, media_folders, page_nodes, audit_events, editing_leases, project_invites, project_members, auth_rate_limits, sessions, auth_credentials, projects, workspaces, users RESTART IDENTITY CASCADE`; });
  afterAll(async () => { await sql.end(); });

  it("generates a page, targets one selected card, and leaves unrelated regions intact", async () => {
    const { owner, project, home } = await setup();
    await runPageJob(owner.id, project.id, home.id, "Create the homepage", pageV1);
    const first = await activeSource(home.id);
    expect((first.manifest as { editableElements: Array<{ canvasId: string }> }).editableElements.map((element) => element.canvasId)).toEqual(["hero-main", "pricing-card-pro"]);

    const result = await runPageJob(owner.id, project.id, home.id, "Make this card more compact", pageCompactCard, { selection: { canvasId: "pricing-card-pro" }, targetCanvasId: "pricing-card-pro" });
    expect(result.job).toMatchObject({ status: "completed", operation: "page_modify", basePageVersionId: first.id });

    const second = await activeSource(home.id);
    expect(second.id).not.toBe(first.id);
    expect(second.versionNumber).toBe(2);
    expect(second.document as { html: string }).toMatchObject({ html: expect.stringContaining("Compact pricing card") });
    // The unrelated hero region is byte-for-byte unchanged and keeps its Canvas ID.
    expect(second.document as { html: string }).toMatchObject({ html: expect.stringContaining(HERO) });
    expect(second.document as { html: string }).not.toMatchObject({ html: expect.stringContaining("Spacious pricing card") });
    expect((await db.select().from(pageVersions).where(eq(pageVersions.id, first.id)))[0]?.document).toMatchObject({ html: pageV1 });

    // The targeted element is persisted with the prompt message and the job.
    const messages = await db.select().from(aiMessages);
    const targeted = messages.find((message) => message.role === "user" && message.content === "Make this card more compact");
    expect(targeted?.metadata).toMatchObject({ selectedElement: { canvasId: "pricing-card-pro", elementType: "article", ownerType: "page", ownerId: home.id } });
    const [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, result.request.job.id));
    expect(job?.contextMetadata).toMatchObject({ selectedElement: { canvasId: "pricing-card-pro" } });
  });

  it("rejects unknown, malformed, foreign-project, and superseded element IDs", async () => {
    const { owner, project, home } = await setup();
    const jobs = new GenerationJobService();
    // No active version yet: there is nothing selectable.
    await expect(jobs.createPageJob(owner.id, { projectId: project.id, pageId: home.id, content: "Edit", selectedMediaIds: [], selection: { canvasId: "hero-main" } })).rejects.toMatchObject({ code: "AI_ELEMENT_NOT_FOUND" });
    await runPageJob(owner.id, project.id, home.id, "Create", pageV1);

    await expect(jobs.createPageJob(owner.id, { projectId: project.id, pageId: home.id, content: "Edit", selectedMediaIds: [], selection: { canvasId: "does-not-exist" } })).rejects.toMatchObject({ code: "AI_ELEMENT_NOT_FOUND" });
    for (const canvasId of ["Hero Main", "../secret", "hero_main"]) {
      await expect(jobs.createPageJob(owner.id, { projectId: project.id, pageId: home.id, content: "Edit", selectedMediaIds: [], selection: { canvasId } })).rejects.toThrow();
    }

    // An ID that only exists in another project's page is not selectable here.
    const stranger = await makeUser("stranger");
    const otherWorkspace = await new WorkspaceService().create(stranger.id, { name: "Other" });
    const otherProject = await new ProjectService().create(stranger.id, { workspaceId: otherWorkspace.id, name: "Other Site" });
    const otherHome = await new PageTreeService().create(stranger.id, { projectId: otherProject.id, type: "page", name: "Home" });
    await runPageJob(stranger.id, otherProject.id, otherHome.id, "Create", page(`<article data-canvas-id="foreign-secret-region">Secret</article>`));
    await expect(jobs.createPageJob(owner.id, { projectId: project.id, pageId: home.id, content: "Edit", selectedMediaIds: [], selection: { canvasId: "foreign-secret-region" } })).rejects.toMatchObject({ code: "AI_ELEMENT_NOT_FOUND" });

    // An ID from a superseded Page Version is no longer selectable.
    await runPageJob(owner.id, project.id, home.id, "Drop the hero", pageWithoutHero);
    await expect(jobs.createPageJob(owner.id, { projectId: project.id, pageId: home.id, content: "Edit", selectedMediaIds: [], selection: { canvasId: "hero-main" } })).rejects.toMatchObject({ code: "AI_ELEMENT_NOT_FOUND" });
    expect(await db.select().from(pageVersions)).toHaveLength(3);
  });

  it("fails a stale selected element instead of applying it to a different element", async () => {
    const { owner, project, home } = await setup();
    await runPageJob(owner.id, project.id, home.id, "Create", pageV1);
    const first = await activeSource(home.id);
    const request = await new GenerationJobService().createPageJob(owner.id, { projectId: project.id, pageId: home.id, content: "Make this card more compact", selectedMediaIds: [], selection: { canvasId: "pricing-card-pro" } });
    await claimGenerationJob("worker");

    // The baseline moves to a version that no longer contains the selected element.
    const [replacement] = await db.insert(pageVersions).values({ projectId: project.id, pageId: home.id, versionNumber: 2, sourceCode: pageWithoutCard, manifest: { editableElements: [{ canvasId: "hero-main", elementType: "section", label: "Hero" }] }, seoMetadata: {}, changeSummary: {}, sourceHash: "b".repeat(64), createdByUserId: owner.id }).returning();
    await db.update(generationJobs).set({ basePageVersionId: replacement!.id }).where(eq(generationJobs.id, request.job.id));

    const result = await new AIOrchestrationService(db, undefined, undefined, fixtureProviderResolver(() => new FixtureProvider(pageCompactCard, { targetCanvasId: "pricing-card-pro" }))).process(request.job.id);
    expect(result).toMatchObject({ status: "failed", errorCode: "AI_ELEMENT_STALE" });
    expect((await activeSource(home.id)).id).toBe(first.id);
  });

  it("rejects a result that targets a different element or drops the target unannounced", async () => {
    const { owner, project, home } = await setup();
    await runPageJob(owner.id, project.id, home.id, "Create", pageV1);
    const first = await activeSource(home.id);

    const mismatch = await runPageJob(owner.id, project.id, home.id, "Make this card more compact", pageCompactCard, { selection: { canvasId: "pricing-card-pro" }, targetCanvasId: "hero-main" });
    expect(mismatch.job).toMatchObject({ status: "failed", errorCode: "AI_ELEMENT_INVALID" });

    const dropped = await runPageJob(owner.id, project.id, home.id, "Make this card more compact", pageWithoutCard, { selection: { canvasId: "pricing-card-pro" }, targetCanvasId: "pricing-card-pro" });
    expect(dropped.job).toMatchObject({ status: "failed", errorCode: "AI_ELEMENT_INVALID" });

    expect((await activeSource(home.id)).id).toBe(first.id);
    expect(await db.select().from(pageVersions)).toHaveLength(1);

    // Removal is allowed when the result declares it.
    const removed = await runPageJob(owner.id, project.id, home.id, "Delete this card", pageWithoutCard, { selection: { canvasId: "pricing-card-pro" }, targetCanvasId: null, targetRemoved: true });
    expect(removed.job).toMatchObject({ status: "completed" });
    expect((await activeSource(home.id)).document).toMatchObject({ html: pageWithoutCard });
  });

  it("keeps targeted edits inside the existing job, lease, cancellation, and concurrency rules", async () => {
    const { owner, project, home } = await setup();
    await runPageJob(owner.id, project.id, home.id, "Create", pageV1);
    const first = await activeSource(home.id);
    const jobs = new GenerationJobService();

    const active = await jobs.createPageJob(owner.id, { projectId: project.id, pageId: home.id, content: "One", selectedMediaIds: [], selection: { canvasId: "pricing-card-pro" } });
    await expect(jobs.createPageJob(owner.id, { projectId: project.id, pageId: home.id, content: "Two", selectedMediaIds: [], selection: { canvasId: "hero-main" } })).rejects.toThrow(/already updating/);

    await jobs.requestCancellation(owner.id, project.id, active.job.id);
    await new AIOrchestrationService(db, undefined, undefined, fixtureProviderResolver(() => new FixtureProvider(pageCompactCard, { targetCanvasId: "pricing-card-pro" }))).process(active.job.id);
    expect(await db.select().from(pageVersions)).toHaveLength(1);
    expect((await activeSource(home.id)).id).toBe(first.id);
  });

  it("targets an element inside a Building Block without touching the page", async () => {
    const { owner, project, home } = await setup();
    const navbar = await new BuildingBlockService().create(owner.id, { projectId: project.id, name: "Global Navbar", kind: "navbar", isGlobal: true });
    await runBlockJob(owner.id, project.id, navbar.id, "Create the navbar", navbarV1);
    const usage = [{ blockId: navbar.id, usageKey: "site-navbar" }];
    await runPageJob(owner.id, project.id, home.id, "Use the navbar", pageUsingNavbar(navbar.id), { blockUsages: usage });
    const pageBefore = await activeSource(home.id);

    // A block-owned element cannot be edited through the page: that would clone the block.
    await expect(new GenerationJobService().createPageJob(owner.id, { projectId: project.id, pageId: home.id, content: "Tighten the navbar", selectedMediaIds: [], selection: { canvasId: "navbar-root", blockId: navbar.id, usageKey: "site-navbar" } }))
      .rejects.toMatchObject({ code: "AI_ELEMENT_INVALID" });

    const result = await runBlockJob(owner.id, project.id, navbar.id, "Tighten the navbar", navbarV2, { selection: { canvasId: "navbar-root", blockId: navbar.id }, targetCanvasId: "navbar-root" });
    expect(result.job).toMatchObject({ status: "completed", operation: "block_modify" });
    const versions = await db.select().from(buildingBlockVersions);
    expect(versions.map((version) => version.versionNumber).sort()).toEqual([1, 2]);
    expect((await activeSource(home.id)).id).toBe(pageBefore.id);
  });

  it("propagates a targeted global Building Block edit to every page usage", async () => {
    const { owner, project, home } = await setup();
    const about = await new PageTreeService().create(owner.id, { projectId: project.id, type: "page", name: "About" });
    const navbar = await new BuildingBlockService().create(owner.id, { projectId: project.id, name: "Global Navbar", kind: "navbar", isGlobal: true });
    await runBlockJob(owner.id, project.id, navbar.id, "Create the navbar", navbarV1);
    const usage = [{ blockId: navbar.id, usageKey: "site-navbar" }];
    for (const target of [home, about]) await runPageJob(owner.id, project.id, target.id, "Use the navbar", pageUsingNavbar(navbar.id), { blockUsages: usage });
    const pageVersionCount = (await db.select().from(pageVersions)).length;

    await runBlockJob(owner.id, project.id, navbar.id, "Tighten the navbar", navbarV2, { selection: { canvasId: "navbar-root", blockId: navbar.id }, targetCanvasId: "navbar-root" });

    const provider = new GeneratedPageContentProvider();
    for (const target of [home, about]) {
      const [node] = await db.select().from(pageNodes).where(eq(pageNodes.id, target.id));
      const rendered = await provider.get(project.id, target.id, node!.currentVersionId!, previewMedia);
      expect(rendered?.composed.html).toContain("Navbar version two");
      expect(rendered?.composed.html).not.toContain("Navbar version one");
    }
    expect((await db.select().from(pageVersions)).length).toBe(pageVersionCount);
    expect((await db.select().from(buildingBlocks).where(eq(buildingBlocks.id, navbar.id)))[0]?.isGlobal).toBe(true);
  });

  it("rejects Building Block selections that name another block or an unbuilt block", async () => {
    const { owner, project } = await setup();
    const blocks = new BuildingBlockService();
    const navbar = await blocks.create(owner.id, { projectId: project.id, name: "Navbar", kind: "navbar" });
    const footer = await blocks.create(owner.id, { projectId: project.id, name: "Footer", kind: "footer" });
    await runBlockJob(owner.id, project.id, navbar.id, "Create", navbarV1);
    const jobs = new GenerationJobService();

    await expect(jobs.createBlockJob(owner.id, { projectId: project.id, blockId: navbar.id, content: "Edit", selectedMediaIds: [], selection: { canvasId: "navbar-root", blockId: footer.id } })).rejects.toMatchObject({ code: "AI_ELEMENT_INVALID" });
    await expect(jobs.createBlockJob(owner.id, { projectId: project.id, blockId: navbar.id, content: "Edit", selectedMediaIds: [], selection: { canvasId: "missing-region" } })).rejects.toMatchObject({ code: "AI_ELEMENT_NOT_FOUND" });
    await expect(jobs.createBlockJob(owner.id, { projectId: project.id, blockId: footer.id, content: "Edit", selectedMediaIds: [], selection: { canvasId: "navbar-root" } })).rejects.toMatchObject({ code: "AI_ELEMENT_NOT_FOUND" });
  });
});
