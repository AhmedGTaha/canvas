import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, sql } from "@/server/db/client";
import { pageNodes, pageVersions, users } from "@/server/db/schema";
import { WorkspaceService } from "@/domain/workspaces/service";
import { ProjectService } from "@/domain/projects/service";
import { PageTreeService } from "@/domain/pages/service";

describe.sequential("Page Version database integrity", () => {
  beforeEach(async () => { await sql`TRUNCATE TABLE generation_job_media, page_versions, generation_jobs, ai_messages, ai_conversations, page_nodes, audit_events, projects, workspaces, users RESTART IDENTITY CASCADE`; });
  afterAll(async () => { await sql.end(); });
  it("rejects version mutation and cross-page current-version pointers", async () => {
    const id = randomUUID(); const [owner] = await db.insert(users).values({ id, email: `${id}@test.dev`, normalizedEmail: `${id}@test.dev`, displayName: "Owner" }).returning();
    const workspace = await new WorkspaceService().create(owner!.id, { name: "Workspace" }); const project = await new ProjectService().create(owner!.id, { workspaceId: workspace.id, name: "Site" }); const pages = new PageTreeService();
    const first = await pages.create(owner!.id, { projectId: project.id, type: "page", name: "Home" }); const second = await pages.create(owner!.id, { projectId: project.id, type: "page", name: "About" });
    const [version] = await db.insert(pageVersions).values({ projectId: project.id, pageId: first.id, versionNumber: 1, document: { schemaVersion: 1, html: `<main data-canvas-id="page"><h1>Page</h1></main>`, css: "", js: "", metadata: null }, manifest: {}, seoMetadata: {}, changeSummary: {}, sourceHash: "a".repeat(64), createdByUserId: owner!.id }).returning();
    await expect(db.update(pageVersions).set({ document: { schemaVersion: 1, html: "<main data-canvas-id=\"x\"></main>", css: "", js: "", metadata: null } }).where(eq(pageVersions.id, version!.id))).rejects.toMatchObject({ cause: { code: "55000" } });
    await expect(db.update(pageNodes).set({ currentVersionId: version!.id }).where(eq(pageNodes.id, second.id))).rejects.toMatchObject({ cause: { code: "23503" } });
  });
});
