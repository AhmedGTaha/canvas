import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, sql } from "@/server/db/client";
import { buildingBlockUsages, buildingBlockVersions, buildingBlocks, users } from "@/server/db/schema";
import { WorkspaceService } from "@/domain/workspaces/service";
import { ProjectService } from "@/domain/projects/service";
import { PageTreeService } from "@/domain/pages/service";
import { BuildingBlockService } from "@/domain/blocks/service";

const fixtureDocument = { schemaVersion: 1, html: `<nav data-canvas-id="navbar" aria-label="Main"><a class="c-link" href="#">Home</a></nav>`, css: "", js: "", metadata: null };
const hash = "a".repeat(64);
async function owner(label: string) { const id = randomUUID(); const [record] = await db.insert(users).values({ id, email: `${label}-${id}@test.dev`, normalizedEmail: `${label}-${id}@test.dev`, displayName: label }).returning(); return record!; }
async function project(userId: string, name: string) { const workspace = await new WorkspaceService().create(userId, { name }); return new ProjectService().create(userId, { workspaceId: workspace.id, name }); }

describe.sequential("Building Block database integrity", { timeout: 60_000 }, () => {
  beforeEach(async () => { await sql`TRUNCATE TABLE building_block_usages, building_block_versions, building_blocks, generation_job_media, page_versions, generation_jobs, ai_messages, ai_conversations, page_nodes, audit_events, projects, workspaces, users RESTART IDENTITY CASCADE`; });
  afterAll(async () => { await sql.end(); });

  it("keeps versions immutable, numbering unique, and active pointers block-local", async () => {
    const user = await owner("owner");
    const site = await project(user.id, "Site");
    const blocks = new BuildingBlockService();
    const navbar = await blocks.create(user.id, { projectId: site.id, name: "Navbar", kind: "navbar", isGlobal: true });
    const footer = await blocks.create(user.id, { projectId: site.id, name: "Footer", kind: "footer" });
    const [version] = await db.insert(buildingBlockVersions).values({ projectId: site.id, buildingBlockId: navbar.id, versionNumber: 1, document: fixtureDocument, manifest: {}, sourceHash: hash, createdByUserId: user.id }).returning();

    await expect(db.update(buildingBlockVersions).set({ document: { schemaVersion: 1, html: "<main data-canvas-id=\"x\"></main>", css: "", js: "", metadata: null } }).where(eq(buildingBlockVersions.id, version!.id))).rejects.toMatchObject({ cause: { code: "55000" } });
    await expect(db.insert(buildingBlockVersions).values({ projectId: site.id, buildingBlockId: navbar.id, versionNumber: 1, document: fixtureDocument, manifest: {}, sourceHash: hash, createdByUserId: user.id })).rejects.toMatchObject({ cause: { code: "23505" } });
    await expect(db.insert(buildingBlockVersions).values({ projectId: site.id, buildingBlockId: navbar.id, versionNumber: 0, document: fixtureDocument, manifest: {}, sourceHash: hash, createdByUserId: user.id })).rejects.toMatchObject({ cause: { code: "23514" } });
    // A block can never activate another block's version.
    await expect(db.update(buildingBlocks).set({ currentVersionId: version!.id }).where(eq(buildingBlocks.id, footer.id))).rejects.toMatchObject({ cause: { code: "23503" } });
    await expect(db.update(buildingBlocks).set({ currentVersionId: version!.id }).where(eq(buildingBlocks.id, navbar.id))).resolves.toBeDefined();
  });

  it("rejects cross-project usage rows and malformed usage keys", async () => {
    const first = await owner("first"); const second = await owner("second");
    const siteA = await project(first.id, "Site A"); const siteB = await project(second.id, "Site B");
    const page = await new PageTreeService().create(first.id, { projectId: siteA.id, type: "page", name: "Home" });
    const blocks = new BuildingBlockService();
    const localBlock = await blocks.create(first.id, { projectId: siteA.id, name: "Navbar", kind: "navbar" });
    const foreignBlock = await blocks.create(second.id, { projectId: siteB.id, name: "Navbar", kind: "navbar" });

    await expect(db.insert(buildingBlockUsages).values({ projectId: siteA.id, pageId: page.id, buildingBlockId: foreignBlock.id, usageKey: "nav" })).rejects.toMatchObject({ cause: { code: "23503" } });
    await expect(db.insert(buildingBlockUsages).values({ projectId: siteB.id, pageId: page.id, buildingBlockId: foreignBlock.id, usageKey: "nav" })).rejects.toMatchObject({ cause: { code: "23503" } });
    await expect(db.insert(buildingBlockUsages).values({ projectId: siteA.id, pageId: page.id, buildingBlockId: localBlock.id, usageKey: "Nav Key" })).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.insert(buildingBlockUsages).values({ projectId: siteA.id, pageId: page.id, buildingBlockId: localBlock.id, usageKey: "nav" })).resolves.toBeDefined();
    await expect(db.insert(buildingBlockUsages).values({ projectId: siteA.id, pageId: page.id, buildingBlockId: localBlock.id, usageKey: "nav" })).rejects.toMatchObject({ cause: { code: "23505" } });
  });

  it("leaves existing projects and pages valid with an empty Building Block library", async () => {
    const user = await owner("owner");
    const site = await project(user.id, "Site");
    await new PageTreeService().create(user.id, { projectId: site.id, type: "page", name: "Home" });
    await expect(new BuildingBlockService().list(user.id, { projectId: site.id })).resolves.toEqual([]);
  });
});
