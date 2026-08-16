import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, sql } from "@/server/db/client";
import { buildingBlockUsages, buildingBlockVersions, buildingBlocks, editingLeases, pageNodes, pageVersions, users } from "@/server/db/schema";
import { WorkspaceService } from "@/domain/workspaces/service";
import { ProjectService } from "@/domain/projects/service";
import { PageTreeService } from "@/domain/pages/service";
import { BuildingBlockService } from "@/domain/blocks/service";
import { HistoryService } from "@/domain/history/undo-service";
import { validateGeneratedBlockSource } from "@/domain/blocks/validation";
import { validateGeneratedPageSource } from "@/domain/page-generation/validator";
import { StarterSectionService } from "@/domain/blocks/starter-library/service";
import { listPageSectionUsages, PageSectionService } from "./page-sections";
import { resolvePageBlockModules } from "./usages";

const PAGE_SOURCE = `export default function Home() {
  return (
    <div className="c-page">
      <section className="c-section c-hero" data-canvas-id="hero">
        <div className="c-container c-stack"><h1>Fresh pasta, made every morning</h1></div>
      </section>
    </div>
  );
}
`;
const NAVBAR_SOURCE = `export default function Navbar() {
  return (
    <nav className="c-navbar" aria-label="Primary" data-canvas-id="navbar">
      <div className="c-container c-actions"><a className="c-nav-brand" href="/"><strong>Osteria</strong></a></div>
    </nav>
  );
}
`;

async function account(label: string) {
  const id = randomUUID();
  const [record] = await db.insert(users).values({ id, email: `${label}-${id}@test.dev`, normalizedEmail: `${label}-${id}@test.dev`, displayName: label }).returning();
  return record!;
}

/** A project with a home page that already has an active, valid Page Version. */
async function siteWithHomePage(userId: string) {
  const workspace = await new WorkspaceService().create(userId, { name: "Restaurant" });
  const project = await new ProjectService().create(userId, { workspaceId: workspace.id, name: "Osteria" });
  const page = await new PageTreeService().create(userId, { projectId: project.id, type: "page", name: "Home" });
  const manifest = await validateGeneratedPageSource({ sourceCode: PAGE_SOURCE, approvedMediaIds: new Set(), activeRoutes: new Set(["/"]) });
  const [version] = await db.insert(pageVersions).values({
    projectId: project.id, pageId: page.id, versionNumber: 1, sourceCode: PAGE_SOURCE, manifest,
    seoMetadata: { title: null, description: null }, changeSummary: { headline: "First version", changes: [], limitations: [] },
    sourceHash: manifest.sourceHash, createdByUserId: userId,
  }).returning();
  await db.update(pageNodes).set({ currentVersionId: version!.id }).where(eq(pageNodes.id, page.id));
  return { project, page, version: version! };
}

/** A generated, global navbar block, ready to be used on a page. */
async function globalNavbar(userId: string, projectId: string) {
  const blocks = new BuildingBlockService();
  const block = await blocks.create(userId, { projectId, name: "Site Navbar", kind: "navbar", isGlobal: true });
  const manifest = await validateGeneratedBlockSource({ sourceCode: NAVBAR_SOURCE, approvedMediaIds: new Set(), activeRoutes: new Set(["/"]) });
  const [version] = await db.insert(buildingBlockVersions).values({
    projectId, buildingBlockId: block.id, versionNumber: 1, sourceCode: NAVBAR_SOURCE, manifest,
    changeSummary: { headline: "First version", changes: [], limitations: [] },
    sourceHash: manifest.sourceHash, createdByUserId: userId,
  }).returning();
  await db.update(buildingBlocks).set({ currentVersionId: version!.id }).where(eq(buildingBlocks.id, block.id));
  return { block, version: version! };
}

async function activeSource(pageId: string) {
  const [row] = await db.select({ source: pageVersions.sourceCode, manifest: pageVersions.manifest })
    .from(pageNodes).innerJoin(pageVersions, eq(pageVersions.id, pageNodes.currentVersionId)).where(eq(pageNodes.id, pageId)).limit(1);
  return row!;
}

describe.sequential("composing pages from reusable sections", () => {
  beforeEach(async () => {
    await sql`TRUNCATE TABLE building_block_usages, building_block_versions, building_blocks, generation_job_media, page_versions, generation_jobs, ai_messages, ai_conversations, page_nodes, change_set_items, change_sets, project_checkpoint_items, project_checkpoints, editing_leases, audit_events, projects, workspaces, users RESTART IDENTITY CASCADE`;
  });
  afterAll(async () => { await sql.end(); });

  /**
   * The reported bug: removing a Navbar left it rendering on Home. The cause was that
   * the only "detach" Canvas had changed a usage's *version resolution*, never the
   * page's reference to the block, so nothing about what the page rendered changed.
   */
  it("removes a Navbar from a page everywhere the page's state is read", async () => {
    const user = await account("owner");
    const { project, page } = await siteWithHomePage(user.id);
    const { block } = await globalNavbar(user.id, project.id);
    const sections = new PageSectionService();

    const added = await sections.addSection(user.id, { projectId: project.id, pageId: page.id, blockId: block.id, placement: { position: "top" } });
    expect((await activeSource(page.id)).source).toContain(`<CanvasBlock blockId="${block.id}"`);
    expect(await db.select().from(buildingBlockUsages).where(eq(buildingBlockUsages.pageId, page.id))).toHaveLength(1);
    expect(await resolvePageBlockModules(db, project.id, page.id)).toHaveLength(1);

    await sections.removeSection(user.id, { projectId: project.id, pageId: page.id, usageKey: added.usageKey as string });

    const after = await activeSource(page.id);
    // 1. the page's own source no longer references the block
    expect(after.source).not.toContain("CanvasBlock");
    // 2. the active Page Version's manifest agrees
    expect((after.manifest as { blockUsages: unknown[] }).blockUsages).toEqual([]);
    // 3. the usage rows the Preview manifest and export both read from are gone
    expect(await db.select().from(buildingBlockUsages).where(eq(buildingBlockUsages.pageId, page.id))).toHaveLength(0);
    // 4. nothing resolves for the generated Preview to render
    expect(await resolvePageBlockModules(db, project.id, page.id)).toHaveLength(0);
    // 5. and the page's section list is empty
    expect(await listPageSectionUsages(db, project.id, page.id)).toEqual([]);
  });

  it("removes the usage, never the reusable section itself", async () => {
    const user = await account("owner");
    const { project, page } = await siteWithHomePage(user.id);
    const { block, version } = await globalNavbar(user.id, project.id);
    const sections = new PageSectionService();
    const added = await sections.addSection(user.id, { projectId: project.id, pageId: page.id, blockId: block.id, placement: { position: "top" } });
    await sections.removeSection(user.id, { projectId: project.id, pageId: page.id, usageKey: added.usageKey as string });

    const [stillThere] = await db.select().from(buildingBlocks).where(eq(buildingBlocks.id, block.id));
    expect(stillThere?.deletedAt).toBeNull();
    expect(stillThere?.currentVersionId).toBe(version.id);
    expect(await new BuildingBlockService().list(user.id, { projectId: project.id })).toHaveLength(1);
    // Its history is intact too: removal creates no Block Version.
    expect(await db.select().from(buildingBlockVersions).where(eq(buildingBlockVersions.buildingBlockId, block.id))).toHaveLength(1);
  });

  it("leaves other pages using the same global section untouched", async () => {
    const user = await account("owner");
    const { project, page } = await siteWithHomePage(user.id);
    const { block } = await globalNavbar(user.id, project.id);
    const about = await new PageTreeService().create(user.id, { projectId: project.id, type: "page", name: "About" });
    const manifest = await validateGeneratedPageSource({ sourceCode: PAGE_SOURCE, approvedMediaIds: new Set(), activeRoutes: new Set(["/", "/about"]) });
    const [aboutVersion] = await db.insert(pageVersions).values({ projectId: project.id, pageId: about.id, versionNumber: 1, sourceCode: PAGE_SOURCE, manifest, seoMetadata: { title: null, description: null }, changeSummary: { headline: "First version", changes: [], limitations: [] }, sourceHash: manifest.sourceHash, createdByUserId: user.id }).returning();
    await db.update(pageNodes).set({ currentVersionId: aboutVersion!.id }).where(eq(pageNodes.id, about.id));

    const sections = new PageSectionService();
    const onHome = await sections.addSection(user.id, { projectId: project.id, pageId: page.id, blockId: block.id, placement: { position: "top" } });
    await sections.addSection(user.id, { projectId: project.id, pageId: about.id, blockId: block.id, placement: { position: "top" } });
    await sections.removeSection(user.id, { projectId: project.id, pageId: page.id, usageKey: onHome.usageKey as string });

    expect(await resolvePageBlockModules(db, project.id, page.id)).toHaveLength(0);
    // The About page still renders the shared navbar, still unpinned, so a change to
    // the block still propagates to it.
    const aboutModules = await resolvePageBlockModules(db, project.id, about.id);
    expect(aboutModules).toHaveLength(1);
    expect(aboutModules[0]?.isGlobal).toBe(true);
    const [aboutUsage] = await db.select().from(buildingBlockUsages).where(eq(buildingBlockUsages.pageId, about.id));
    expect(aboutUsage?.buildingBlockVersionId).toBeNull();
  });

  it("makes adding and removing a section an ordinary, undoable version move", async () => {
    const user = await account("owner");
    const { project, page, version } = await siteWithHomePage(user.id);
    const { block } = await globalNavbar(user.id, project.id);
    const sections = new PageSectionService();
    const history = new HistoryService();

    const added = await sections.addSection(user.id, { projectId: project.id, pageId: page.id, blockId: block.id, placement: { position: "top" } });
    const removed = await sections.removeSection(user.id, { projectId: project.id, pageId: page.id, usageKey: added.usageKey as string });
    // Historical versions are never rewritten: three immutable versions exist.
    const versions = await db.select().from(pageVersions).where(eq(pageVersions.pageId, page.id));
    expect(versions).toHaveLength(3);
    expect(versions.find((row) => row.id === version.id)?.sourceCode).toBe(PAGE_SOURCE);

    // Undo puts the section back, reference, usage row and all.
    await history.undo(user.id, project.id);
    expect((await activeSource(page.id)).source).toContain("CanvasBlock");
    expect(await resolvePageBlockModules(db, project.id, page.id)).toHaveLength(1);

    // Redo takes it off again.
    await history.redo(user.id, project.id);
    expect((await activeSource(page.id)).source).not.toContain("CanvasBlock");
    expect(await resolvePageBlockModules(db, project.id, page.id)).toHaveLength(0);
    expect(removed.pageVersionId).toBeTruthy();
  });

  it("adds a section where the page structure says it should go", async () => {
    const user = await account("owner");
    const { project, page } = await siteWithHomePage(user.id);
    const { block } = await globalNavbar(user.id, project.id);
    const sections = new PageSectionService();

    await sections.addSection(user.id, { projectId: project.id, pageId: page.id, blockId: block.id, placement: { position: "top" } });
    await sections.addSection(user.id, { projectId: project.id, pageId: page.id, blockId: block.id, placement: { position: "after", anchor: "hero" } });
    const usages = await listPageSectionUsages(db, project.id, page.id);
    expect(usages.map((usage) => usage.usageKey)).toEqual(["site-navbar", "site-navbar-2"]);
    const source = (await activeSource(page.id)).source;
    expect(source.indexOf("site-navbar\"")).toBeLessThan(source.indexOf("hero"));
    expect(source.indexOf("hero")).toBeLessThan(source.indexOf("site-navbar-2"));
    // Two usages of one block never collide, and both resolve to the same module.
    expect(await resolvePageBlockModules(db, project.id, page.id)).toHaveLength(1);
  });

  it("refuses to remove a section a page does not have", async () => {
    const user = await account("owner");
    const { project, page } = await siteWithHomePage(user.id);
    await expect(new PageSectionService().removeSection(user.id, { projectId: project.id, pageId: page.id, usageKey: "not-there" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("copies a built-in starter into the project as an ordinary Building Block", async () => {
    const user = await account("owner");
    const { project, page } = await siteWithHomePage(user.id);
    const created = await new StarterSectionService().use(user.id, { projectId: project.id, starterId: "navbar-classic", isGlobal: true });

    expect(created.projectId).toBe(project.id);
    expect(created.createdByUserId).toBe(user.id);
    expect(created.isGlobal).toBe(true);
    const versions = await db.select().from(buildingBlockVersions).where(eq(buildingBlockVersions.buildingBlockId, created.id));
    expect(versions).toHaveLength(1);
    expect(versions[0]?.versionNumber).toBe(1);
    // It behaves like any other block from here: it can be used, made global, archived.
    const added = await new PageSectionService().addSection(user.id, { projectId: project.id, pageId: page.id, blockId: created.id, placement: { position: "top" } });
    expect(await resolvePageBlockModules(db, project.id, page.id)).toHaveLength(1);
    await new PageSectionService().removeSection(user.id, { projectId: project.id, pageId: page.id, usageKey: added.usageKey as string });
    await expect(new BuildingBlockService().archive(user.id, { projectId: project.id, blockId: created.id })).resolves.toBeDefined();
  });

  it("keeps a collaborator's concurrent composition edit out of another's", async () => {
    const user = await account("owner");
    const { project, page } = await siteWithHomePage(user.id);
    const { block } = await globalNavbar(user.id, project.id);
    const other = await account("collaborator");
    // The editing lease another collaborator already holds on this page is what stops
    // two commits racing: a composition edit takes the same lease a generation does.
    await db.insert(editingLeases).values({ projectId: project.id, targetType: "page", targetId: page.id, userId: other.id, expiresAt: new Date(Date.now() + 60_000) });
    await expect(new PageSectionService().addSection(user.id, { projectId: project.id, pageId: page.id, blockId: block.id, placement: { position: "top" } })).rejects.toMatchObject({ code: "CONFLICT" });
    // Nothing was written: the page still has no sections on it.
    expect(await db.select().from(buildingBlockUsages).where(and(eq(buildingBlockUsages.projectId, project.id), eq(buildingBlockUsages.pageId, page.id)))).toHaveLength(0);
  });

  /*
   * Found by driving the real product: the first thing anyone does with a new site is
   * put a navbar on a page nobody has generated yet, and that was refused outright.
   */
  it("starts an unbuilt page from an empty shell so a section can be its first content", async () => {
    const user = await account("owner");
    const workspace = await new WorkspaceService().create(user.id, { name: "Restaurant" });
    const project = await new ProjectService().create(user.id, { workspaceId: workspace.id, name: "Osteria" });
    const page = await new PageTreeService().create(user.id, { projectId: project.id, type: "page", name: "Home" });
    const { block } = await globalNavbar(user.id, project.id);
    expect((await db.select().from(pageNodes).where(eq(pageNodes.id, page.id)))[0]?.currentVersionId).toBeNull();

    const added = await new PageSectionService().addSection(user.id, { projectId: project.id, pageId: page.id, blockId: block.id, placement: { position: "top" } });

    const active = await activeSource(page.id);
    expect(active.source).toContain(`<CanvasBlock blockId="${block.id}"`);
    expect((await db.select().from(pageVersions).where(eq(pageVersions.pageId, page.id)))[0]?.versionNumber).toBe(1);
    expect(await resolvePageBlockModules(db, project.id, page.id)).toHaveLength(1);

    // Undo returns the page to unbuilt rather than to a version that never existed.
    await new HistoryService().undo(user.id, project.id);
    const [after] = await db.select().from(pageNodes).where(eq(pageNodes.id, page.id));
    expect(after?.currentVersionId).toBeNull();
    expect(await resolvePageBlockModules(db, project.id, page.id)).toHaveLength(0);
    expect(added.usageKey).toBe("site-navbar");
  });

  /*
   * Also found by driving the product: adding a library section used to be two requests,
   * and a failure of the second left a block in the library that nobody had asked for.
   */
  it("creates a starter and places it in one transaction, leaving nothing behind on failure", async () => {
    const user = await account("owner");
    const { project, page } = await siteWithHomePage(user.id);
    const sections = new PageSectionService();

    const added = await sections.addSection(user.id, { projectId: project.id, pageId: page.id, starterId: "navbar-classic", placement: { position: "top" } });
    const blocks = await db.select().from(buildingBlocks).where(eq(buildingBlocks.projectId, project.id));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.name).toBe("Classic bar");
    expect(await resolvePageBlockModules(db, project.id, page.id)).toHaveLength(1);
    expect(added.blockId).toBe(blocks[0]!.id);

    // A placement that cannot be satisfied rolls the whole thing back: no orphan block.
    await expect(sections.addSection(user.id, { projectId: project.id, pageId: page.id, starterId: "footer-minimal", placement: { position: "after", anchor: "not-on-this-page" } }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await db.select().from(buildingBlocks).where(eq(buildingBlocks.projectId, project.id))).toHaveLength(1);
  });

  it("refuses a request that names both an existing section and a starter", async () => {
    const user = await account("owner");
    const { project, page } = await siteWithHomePage(user.id);
    const { block } = await globalNavbar(user.id, project.id);
    await expect(new PageSectionService().addSection(user.id, { projectId: project.id, pageId: page.id, blockId: block.id, starterId: "navbar-classic" })).rejects.toThrow();
    await expect(new PageSectionService().addSection(user.id, { projectId: project.id, pageId: page.id })).rejects.toThrow();
  });
});
