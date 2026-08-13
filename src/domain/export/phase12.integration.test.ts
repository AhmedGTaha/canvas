import { randomUUID } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, sql } from "@/server/db/client";
import { buildingBlocks, exportJobs, mediaAssets, pageNodes, pageVersions, projectBrandSettings, users } from "@/server/db/schema";
import { WorkspaceService } from "@/domain/workspaces/service";
import { ProjectService } from "@/domain/projects/service";
import { PageTreeService } from "@/domain/pages/service";
import { BuildingBlockService } from "@/domain/blocks/service";
import { GenerationJobService, claimGenerationJob } from "@/domain/ai/job-service";
import { AIOrchestrationService } from "@/domain/ai/orchestration-service";
import type { AIProvider, AIRequest, AIResponse, StructuredValidator } from "@/domain/ai/provider";
import { getObjectStorage } from "@/server/storage";
import { ExportService } from "@/domain/export/export-service";
import { ThemeService } from "@/domain/theme/services";
import { DEFAULT_THEME } from "@/domain/theme/defaults";

// A 1x1 PNG: enough for storage round-tripping and format checks.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const navbar = `export default function Block(){return <nav data-canvas-id="navbar-root" aria-label="Main"><a href="/">Home</a><span>Contact</span></nav>}`;
const navbarV2 = `export default function Block(){return <nav data-canvas-id="navbar-root" aria-label="Main"><a href="/">Home</a><span>Contact us</span></nav>}`;
const footer = `export default function Block(){return <footer data-canvas-id="footer-root"><p className="c-muted">© Acme</p></footer>}`;
const interactiveCard = `"use client";\nimport { useState } from "react";\nexport default function Block(){const [open,setOpen]=useState(false);return <article data-canvas-id="faq-card"><button onClick={()=>setOpen(!open)}>Toggle</button>{open&&<p>Answer</p>}</article>}`;

type FixtureOptions = { blockUsages?: Array<{ blockId: string; usageKey: string }>; referencedMediaIds?: string[] };
class FixtureProvider implements AIProvider {
  name = "fixture"; model = "fixture-1";
  constructor(private readonly source: string, private readonly options: FixtureOptions = {}) {}
  async generateText(): Promise<AIResponse> { return { text: "", provider: this.name, model: this.model }; }
  async generateStructured<T>(_request: AIRequest, validator: StructuredValidator<T>): Promise<AIResponse<T>> {
    const value = {
      schemaVersion: 1, sourceCode: this.source, referencedMediaIds: this.options.referencedMediaIds ?? [],
      ...(this.options.blockUsages?.length ? { blockUsages: this.options.blockUsages } : {}),
      summary: { headline: "Built", changes: ["Created content"], limitations: [] },
    };
    return { text: "", structuredData: validator.parse(value), provider: this.name, model: this.model };
  }
}

async function makeUser(label: string) { const id = randomUUID(); const [record] = await db.insert(users).values({ id, email: `${label}-${id}@test.dev`, normalizedEmail: `${label}-${id}@test.dev`, displayName: label }).returning(); return record!; }
async function setup() {
  const owner = await makeUser("owner");
  const workspace = await new WorkspaceService().create(owner.id, { name: "Workspace" });
  const project = await new ProjectService().create(owner.id, { workspaceId: workspace.id, name: "Acme Site" });
  const home = await new PageTreeService().create(owner.id, { projectId: project.id, type: "page", name: "Home" });
  return { owner, project, home };
}
async function runPageJob(userId: string, projectId: string, pageId: string, source: string, options: FixtureOptions = {}) {
  const request = await new GenerationJobService().createPageJob(userId, { projectId, pageId, content: "build", selectedMediaIds: [] });
  await claimGenerationJob("worker");
  const job = await new AIOrchestrationService(db, undefined, undefined, () => new FixtureProvider(source, options)).process(request.job.id);
  if (job?.status !== "completed") throw new Error(`page job failed: ${job?.status} ${job?.errorCode}`);
}
async function runBlockJob(userId: string, projectId: string, blockId: string, source: string, options: FixtureOptions = {}) {
  const request = await new GenerationJobService().createBlockJob(userId, { projectId, blockId, content: "build", selectedMediaIds: [] });
  await claimGenerationJob("worker");
  const job = await new AIOrchestrationService(db, undefined, undefined, () => new FixtureProvider(source, options)).process(request.job.id);
  if (job?.status !== "completed") throw new Error(`block job failed: ${job?.status} ${job?.errorCode}`);
}
async function addMedia(projectId: string, userId: string, displayName: string) {
  const storageKey = `test-media/${randomUUID()}.png`;
  await getObjectStorage().put(storageKey, PNG);
  const [asset] = await db.insert(mediaAssets).values({ projectId, originalFilename: "logo.png", displayName, storageKey, mimeType: "image/png", sizeBytes: PNG.length, width: 1, height: 1, altText: "Acme logo", createdByUserId: userId }).returning();
  await db.update(projectBrandSettings).set({ primaryLogoMediaId: asset!.id }).where(eq(projectBrandSettings.projectId, projectId));
  return asset!;
}

/** Reads a ZIP produced by ZipPackager back into a path → contents map. */
function readZip(archive: Uint8Array) {
  const buffer = Buffer.from(archive);
  const endIndex = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endIndex < 0) throw new Error("Not a ZIP archive");
  const count = buffer.readUInt16LE(endIndex + 10);
  let cursor = buffer.readUInt32LE(endIndex + 16);
  const files = new Map<string, Buffer>();
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error("Corrupt central directory");
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const body = buffer.subarray(start, start + compressedSize);
    files.set(name, method === 8 ? inflateRawSync(body) : Buffer.from(body));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}
async function exportProject(userId: string, projectId: string) {
  const service = new ExportService();
  const job = await service.create(userId, projectId);
  const finished = await service.process(job.id);
  return { service, jobId: job.id, job: finished, state: await service.get(userId, projectId, job.id) };
}
async function exportedFiles(userId: string, projectId: string) {
  const { service, jobId, state } = await exportProject(userId, projectId);
  expect(state.status).toBe("completed");
  const artifact = await service.download(userId, projectId, jobId);
  return { files: readZip(artifact.bytes), fileName: artifact.fileName, state };
}
const asText = (files: Map<string, Buffer>, path: string) => files.get(path)?.toString("utf8") ?? "";

describe.sequential("Phase 12 validated ZIP export", () => {
  beforeEach(async () => { await sql`TRUNCATE TABLE export_jobs, project_checkpoint_items, project_checkpoints, change_set_items, change_sets, building_block_usages, building_block_versions, building_blocks, generation_job_media, page_versions, ai_job_rate_limits, generation_jobs, ai_messages, ai_conversations, project_instructions, media_assets, media_folders, page_nodes, audit_events, editing_leases, project_invites, project_members, auth_rate_limits, sessions, auth_credentials, projects, workspaces, users RESTART IDENTITY CASCADE`; });
  afterAll(async () => {
    await rm(path.resolve(process.cwd(), process.env.LOCAL_STORAGE_PATH || ".canvas-storage", "test-media"), { recursive: true, force: true });
    await sql.end();
  });

  it("exports a simple project as a runnable standalone Next.js app", async () => {
    const { owner, project, home } = await setup();
    await runPageJob(owner.id, project.id, home.id, `export default function Page(){return <main className="c-page" data-canvas-id="home-root"><h1>Welcome to Acme</h1></main>}`);
    const { files, fileName, state } = await exportedFiles(owner.id, project.id);

    for (const required of ["package.json", "tsconfig.json", "next.config.mjs", "next-env.d.ts", "README.md", "styles/globals.css", "app/layout.tsx", "app/page.tsx", "app/not-found.tsx"]) {
      expect(files.has(required), `${required} missing`).toBe(true);
    }
    expect(fileName).toMatch(/^acme-site-[0-9a-f]{8}\.zip$/);
    expect(state.validation).toMatchObject({ ok: true, pageCount: 1 });
    expect(state.artifact).toMatchObject({ fileCount: files.size, bytes: expect.any(Number) });

    const packageJson = JSON.parse(asText(files, "package.json")) as { scripts: Record<string, string>; dependencies: Record<string, string> };
    expect(packageJson.scripts).toMatchObject({ dev: "next dev", build: "next build" });
    expect(packageJson.dependencies).toHaveProperty("next");
    expect(asText(files, "README.md")).toContain("npm install");
    expect(asText(files, "README.md")).toContain("frontend-only");
    expect(asText(files, "app/page.tsx")).toContain("export const metadata");
    // The generated page became a plain component with no Canvas runtime left in it.
    const [componentPath] = [...files.keys()].filter((name) => name.startsWith("components/pages/"));
    expect(asText(files, componentPath!)).toContain("Welcome to Acme");
    expect(asText(files, componentPath!)).not.toContain("data-canvas-id");
  });

  it("exports generated Pages and Blocks with the same token-backed theme and logo behavior as Preview", async () => {
    const { owner, project, home } = await setup();
    const asset = await addMedia(project.id, owner.id, "Company Logo");
    const themes = new ThemeService();
    const current = await themes.read(owner.id, project.id);
    await themes.update(owner.id, {
      projectId: project.id,
      expectedRevision: current.revision,
      theme: {
        ...DEFAULT_THEME,
        lightTokens: { ...DEFAULT_THEME.lightTokens, primary: "#135790", text: "#246801", surface: "#357912" },
        darkTokens: { ...DEFAULT_THEME.darkTokens, primary: "#FDB975", text: "#ECA864", surface: "#102030" },
        radiusScale: 75, spacingScale: 65, shadowScale: 55, fontScale: 45, borderScale: 35,
      },
    });
    const block = await new BuildingBlockService().create(owner.id, { projectId: project.id, name: "Global Navbar", kind: "navbar", isGlobal: true });
    const blockSource = `import { CanvasImage } from "@canvas/site-runtime";\nexport default function Navbar(){return <nav className="c-navbar"><div className="c-container c-cluster"><a href="/" className="c-nav-brand"><CanvasImage mediaId="${asset.id}" alt="Acme" className="c-logo" /></a><div className="c-nav-links"><a href="/" className="c-link">Home</a></div></div></nav>}`;
    await runBlockJob(owner.id, project.id, block.id, blockSource, { referencedMediaIds: [asset.id] });
    await runPageJob(owner.id, project.id, home.id, `import { CanvasBlock } from "@canvas/site-runtime";\nexport default function Page(){return <main className="c-page"><CanvasBlock blockId="${block.id}" usageKey="site-navbar" /><section className="c-section c-surface"><h1>Home</h1></section></main>}`, { blockUsages: [{ blockId: block.id, usageKey: "site-navbar" }] });

    const { files } = await exportedFiles(owner.id, project.id);
    const css = asText(files, "styles/globals.css");
    expect(css).toContain("--color-primary:#135790");
    expect(css).toContain("--color-text:#246801");
    expect(css).toContain("--color-surface:#357912");
    expect(css).toContain("@media (prefers-color-scheme: dark){:root{--color-primary:#FDB975");
    for (const variable of ["--radius-md", "--space-md", "--shadow-md", "--body-size", "--border-width"]) expect(css).toContain(variable);
    expect(css).toContain(".c-navbar,nav.c-section");
    expect(css).toContain("a{color:var(--color-accent)");
    expect(css).toContain("img.c-logo{display:block;width:auto;height:calc(var(--body-size)*2.5)");
    const exportedBlock = asText(files, [...files.keys()].find((name) => name.startsWith("components/blocks/"))!);
    expect(exportedBlock).toContain(`className="canvas-image c-logo"`);
    expect(exportedBlock).toContain(`src="/assets/company-logo-`);
  });

  it("exports nested routes, SEO metadata, and a 404 page", async () => {
    const { owner, project, home } = await setup();
    const pages = new PageTreeService();
    const company = await pages.create(owner.id, { projectId: project.id, type: "folder", name: "Company" });
    const about = await pages.create(owner.id, { projectId: project.id, type: "page", name: "About", parentId: company.id });
    const team = await pages.create(owner.id, { projectId: project.id, type: "page", name: "Team", parentId: about.id });
    await pages.updateSeo(owner.id, { projectId: project.id, nodeId: about.id, pageTitle: "About Acme", metaDescription: "Who we are." });
    const body = (heading: string) => `export default function Page(){return <main className="c-page"><h1>${heading}</h1><a href="/">Home</a></main>}`;
    await runPageJob(owner.id, project.id, home.id, body("Home"));
    await runPageJob(owner.id, project.id, about.id, body("About"));
    await runPageJob(owner.id, project.id, team.id, body("Team"));

    const { files } = await exportedFiles(owner.id, project.id);
    expect(files.has("app/page.tsx")).toBe(true);
    // The folder is organisational: only routable pages become directories.
    expect(files.has("app/about/page.tsx")).toBe(true);
    expect(files.has("app/about/team/page.tsx")).toBe(true);
    expect([...files.keys()].some((name) => name.startsWith("app/company/"))).toBe(false);
    const aboutRoute = asText(files, "app/about/page.tsx");
    expect(aboutRoute).toContain(`title: "About Acme"`);
    expect(aboutRoute).toContain(`description: "Who we are."`);
    expect(asText(files, "app/page.tsx")).toContain(`title: "Home"`);
  });

  it("exports a global navbar and footer once and imports them from every page", async () => {
    const { owner, project, home } = await setup();
    const contact = await new PageTreeService().create(owner.id, { projectId: project.id, type: "page", name: "Contact" });
    const blocks = new BuildingBlockService();
    const navbarBlock = await blocks.create(owner.id, { projectId: project.id, name: "Global Navbar", kind: "navbar", isGlobal: true });
    const footerBlock = await blocks.create(owner.id, { projectId: project.id, name: "Global Footer", kind: "footer", isGlobal: true });
    await runBlockJob(owner.id, project.id, navbarBlock.id, navbar);
    await runBlockJob(owner.id, project.id, footerBlock.id, footer);
    const usages = [{ blockId: navbarBlock.id, usageKey: "site-navbar" }, { blockId: footerBlock.id, usageKey: "site-footer" }];
    const source = `import { CanvasBlock } from "@canvas/site-runtime";\nexport default function Page(){return <main className="c-page"><CanvasBlock blockId="${navbarBlock.id}" usageKey="site-navbar" /><h1>Page</h1><CanvasBlock blockId="${footerBlock.id}" usageKey="site-footer" /></main>}`;
    for (const target of [home, contact]) await runPageJob(owner.id, project.id, target.id, source, { blockUsages: usages });

    const { files } = await exportedFiles(owner.id, project.id);
    const blockFiles = [...files.keys()].filter((name) => name.startsWith("components/blocks/"));
    expect(blockFiles).toHaveLength(2);
    const pageFiles = [...files.keys()].filter((name) => name.startsWith("components/pages/"));
    expect(pageFiles).toHaveLength(2);
    for (const pageFile of pageFiles) {
      const contents = asText(files, pageFile);
      expect(contents).toMatch(/import \w+ from "@\/components\/blocks\/\w+";/);
      // Block markup is imported, never copied into the page.
      expect(contents).not.toContain("<nav");
      expect(contents).not.toContain("© Acme");
      expect(contents).not.toContain("CanvasBlock");
    }
    expect(blockFiles.map((name) => asText(files, name)).join("\n")).toContain("<nav");
  });

  it("exports the pinned historical version for a non-global block usage", async () => {
    const { owner, project, home } = await setup();
    const other = await new PageTreeService().create(owner.id, { projectId: project.id, type: "page", name: "Contact" });
    const block = await new BuildingBlockService().create(owner.id, { projectId: project.id, name: "Menu", kind: "navbar" });
    await runBlockJob(owner.id, project.id, block.id, navbar);
    const source = `import { CanvasBlock } from "@canvas/site-runtime";\nexport default function Page(){return <main className="c-page"><CanvasBlock blockId="${block.id}" usageKey="menu" /></main>}`;
    await runPageJob(owner.id, project.id, home.id, source, { blockUsages: [{ blockId: block.id, usageKey: "menu" }] });
    // Home stays pinned to v1 while a later page picks up v2.
    await runBlockJob(owner.id, project.id, block.id, navbarV2);
    await runPageJob(owner.id, project.id, other.id, source, { blockUsages: [{ blockId: block.id, usageKey: "menu" }] });

    const { files } = await exportedFiles(owner.id, project.id);
    const blockFiles = [...files.keys()].filter((name) => name.startsWith("components/blocks/"));
    expect(blockFiles).toHaveLength(2);
    const contents = blockFiles.map((name) => asText(files, name));
    expect(contents.some((body) => body.includes(">Contact<"))).toBe(true);
    expect(contents.some((body) => body.includes(">Contact us<"))).toBe(true);
    // Each page imports the component matching the version it was built against.
    const pageImports = [...files.keys()].filter((name) => name.startsWith("components/pages/")).map((name) => /@\/components\/blocks\/(\w+)/.exec(asText(files, name))?.[1]);
    expect(new Set(pageImports).size).toBe(2);
  });

  it("copies referenced media into public assets and rewrites references to local paths", async () => {
    const { owner, project, home } = await setup();
    const asset = await addMedia(project.id, owner.id, "Company Logo");
    const source = `import { CanvasImage } from "@canvas/site-runtime";\nexport default function Page(){return <main className="c-page"><CanvasImage mediaId="${asset.id}" alt="Acme" className="c-media" /></main>}`;
    await runPageJob(owner.id, project.id, home.id, source, { referencedMediaIds: [asset.id] });

    const { files } = await exportedFiles(owner.id, project.id);
    const assets = [...files.keys()].filter((name) => name.startsWith("public/assets/"));
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatch(/^public\/assets\/company-logo-[0-9a-f]{8}\.png$/);
    expect(files.get(assets[0]!)!.equals(PNG)).toBe(true);
    const component = asText(files, [...files.keys()].find((name) => name.startsWith("components/pages/"))!);
    expect(component).toContain(`src="/assets/company-logo-`);
    expect(component).toContain(`alt="Acme"`);
    expect(component).toContain("<img");
    // No Canvas identifiers, storage keys, or preview URLs survive.
    expect(component).not.toContain(asset.id);
    expect(component).not.toContain(asset.storageKey);
    expect(component).not.toContain("/api/preview/media");
    expect(component).not.toContain("CanvasImage");
  });

  it("keeps interactive blocks working as client components", async () => {
    const { owner, project, home } = await setup();
    const block = await new BuildingBlockService().create(owner.id, { projectId: project.id, name: "FAQ", kind: "card", isGlobal: true });
    await runBlockJob(owner.id, project.id, block.id, interactiveCard);
    await runPageJob(owner.id, project.id, home.id, `import { CanvasBlock } from "@canvas/site-runtime";\nexport default function Page(){return <main className="c-page"><CanvasBlock blockId="${block.id}" usageKey="faq" /></main>}`, { blockUsages: [{ blockId: block.id, usageKey: "faq" }] });

    const { files } = await exportedFiles(owner.id, project.id);
    const blockFile = [...files.keys()].find((name) => name.startsWith("components/blocks/"))!;
    expect(asText(files, blockFile)).toMatch(/^"use client";/);
    expect(asText(files, blockFile)).toContain("useState");
  });

  it("produces no Canvas identifiers, secrets, or backend code anywhere in the archive", async () => {
    const { owner, project, home } = await setup();
    const asset = await addMedia(project.id, owner.id, "Logo");
    const block = await new BuildingBlockService().create(owner.id, { projectId: project.id, name: "Navbar", kind: "navbar", isGlobal: true });
    await runBlockJob(owner.id, project.id, block.id, navbar);
    await runPageJob(owner.id, project.id, home.id, `import { CanvasBlock, CanvasImage } from "@canvas/site-runtime";\nexport default function Page(){return <main className="c-page" data-canvas-id="root"><CanvasBlock blockId="${block.id}" usageKey="nav" /><CanvasImage mediaId="${asset.id}" alt="Logo" /></main>}`, { blockUsages: [{ blockId: block.id, usageKey: "nav" }], referencedMediaIds: [asset.id] });

    const { files } = await exportedFiles(owner.id, project.id);
    const textual = [...files.entries()].filter(([name]) => !name.startsWith("public/assets/"));
    const combined = textual.map(([, contents]) => contents.toString("utf8")).join("\n");
    for (const forbidden of ["data-canvas-id", "data-canvas-block", "data-canvas-usage", "data-canvas-label", "@canvas/site-runtime", "__CANVAS_PREVIEW__", "PREVIEW_TOKEN_SECRET", "DATABASE_URL", "process.env", "server-only", "drizzle-orm", project.id, block.id, asset.id, asset.storageKey]) {
      expect(combined, `archive leaked ${forbidden}`).not.toContain(forbidden);
    }
    for (const name of files.keys()) {
      expect(name).not.toMatch(/^app\/api\//);
      expect(name).not.toMatch(/route\.tsx?$/);
      expect(name).not.toMatch(/middleware\./);
      expect(name).not.toMatch(/\.env/);
    }
  });

  it.each([
    ["a page that was never built", async (owner: { id: string }, project: { id: string }) => { await new PageTreeService().create(owner.id, { projectId: project.id, type: "page", name: "Empty" }); }, "PAGE_UNBUILT"],
    ["media deleted after the page was built", async (owner: { id: string }, project: { id: string }, home: { id: string }) => {
      const asset = await addMedia(project.id, owner.id, "Logo");
      await runPageJob(owner.id, project.id, home.id, `import { CanvasImage } from "@canvas/site-runtime";\nexport default function Page(){return <main className="c-page"><CanvasImage mediaId="${asset.id}" alt="L" /></main>}`, { referencedMediaIds: [asset.id] });
      await db.update(mediaAssets).set({ deletedAt: new Date() }).where(eq(mediaAssets.id, asset.id));
    }, "MEDIA_MISSING"],
    ["a Building Block archived after the page was built", async (owner: { id: string }, project: { id: string }, home: { id: string }) => {
      const block = await new BuildingBlockService().create(owner.id, { projectId: project.id, name: "Navbar", kind: "navbar", isGlobal: true });
      await runBlockJob(owner.id, project.id, block.id, navbar);
      await runPageJob(owner.id, project.id, home.id, `import { CanvasBlock } from "@canvas/site-runtime";\nexport default function Page(){return <main className="c-page"><CanvasBlock blockId="${block.id}" usageKey="nav" /></main>}`, { blockUsages: [{ blockId: block.id, usageKey: "nav" }] });
      await db.update(buildingBlocks).set({ deletedAt: new Date() }).where(eq(buildingBlocks.id, block.id));
    }, "BLOCK_MISSING"],
    ["a broken internal link", async (owner: { id: string }, project: { id: string }, home: { id: string }) => {
      const extra = await new PageTreeService().create(owner.id, { projectId: project.id, type: "page", name: "Pricing" });
      await runPageJob(owner.id, project.id, extra.id, `export default function Page(){return <main className="c-page"><h1>Pricing</h1></main>}`);
      await runPageJob(owner.id, project.id, home.id, `export default function Page(){return <main className="c-page"><a href="/pricing">Pricing</a></main>}`);
      await new PageTreeService().deleteSubtree(owner.id, { projectId: project.id, nodeId: extra.id });
    }, "LINK_BROKEN"],
    ["unsafe source stored outside the normal pipeline", async (owner: { id: string }, project: { id: string }, home: { id: string }) => {
      await runPageJob(owner.id, project.id, home.id, `export default function Page(){return <main className="c-page"><h1>Hi</h1></main>}`);
      const [version] = await db.select().from(pageVersions).limit(1);
      const [unsafe] = await db.insert(pageVersions).values({ projectId: project.id, pageId: home.id, versionNumber: 90, sourceCode: `export default function Page(){fetch("https://tracker.example/collect");return <main/>}`, manifest: version!.manifest, seoMetadata: {}, changeSummary: {}, sourceHash: "d".repeat(64), createdByUserId: owner.id }).returning();
      await db.update(pageNodes).set({ currentVersionId: unsafe!.id }).where(eq(pageNodes.id, home.id));
    }, "SOURCE_INVALID"],
    ["backend code stored outside the normal pipeline", async (owner: { id: string }, project: { id: string }, home: { id: string }) => {
      await runPageJob(owner.id, project.id, home.id, `export default function Page(){return <main className="c-page"><h1>Hi</h1></main>}`);
      const [version] = await db.select().from(pageVersions).limit(1);
      const [unsafe] = await db.insert(pageVersions).values({ projectId: project.id, pageId: home.id, versionNumber: 91, sourceCode: `import { cookies } from "next/headers";\nexport default function Page(){return <main>{cookies().toString()}</main>}`, manifest: version!.manifest, seoMetadata: {}, changeSummary: {}, sourceHash: "e".repeat(64), createdByUserId: owner.id }).returning();
      await db.update(pageNodes).set({ currentVersionId: unsafe!.id }).where(eq(pageNodes.id, home.id));
    }, "SOURCE_INVALID"],
  ])("fails validation for %s and produces no downloadable artifact", async (_name, prepare, code) => {
    const { owner, project, home } = await setup();
    await runPageJob(owner.id, project.id, home.id, `export default function Page(){return <main className="c-page"><h1>Home</h1></main>}`).catch(() => undefined);
    await prepare(owner, project, home);

    const { service, jobId, state } = await exportProject(owner.id, project.id);
    expect(state.status).toBe("failed");
    expect(state.errorCode).toBe("EXPORT_VALIDATION_FAILED");
    expect(state.validation?.failures.map((failure) => failure.code)).toContain(code);
    expect(state.artifact).toBeNull();
    await expect(service.download(owner.id, project.id, jobId)).rejects.toMatchObject({ exportCode: "EXPORT_NOT_READY" });
    const [row] = await db.select().from(exportJobs).where(eq(exportJobs.id, jobId));
    expect(row?.artifactStorageKey).toBeNull();
  });

  it("rejects a page whose route drifted out of sync", async () => {
    const { owner, project, home } = await setup();
    const about = await new PageTreeService().create(owner.id, { projectId: project.id, type: "page", name: "About" });
    const body = `export default function Page(){return <main className="c-page"><h1>Page</h1></main>}`;
    await runPageJob(owner.id, project.id, home.id, body);
    await runPageJob(owner.id, project.id, about.id, body);
    await db.update(pageNodes).set({ slug: "renamed" }).where(eq(pageNodes.id, about.id));
    const { state } = await exportProject(owner.id, project.id);
    expect(state.status).toBe("failed");
    expect(state.validation?.failures.map((failure) => failure.code)).toContain("ROUTE_INVALID");
  });

  it("fails the build stage when the assembled project would not type-check", async () => {
    const { owner, project, home } = await setup();
    await runPageJob(owner.id, project.id, home.id, `export default function Page(){return <main className="c-page"><h1>Home</h1></main>}`);
    const [version] = await db.select().from(pageVersions).limit(1);
    // Valid, safe TSX that is nonetheless not type-correct once exported.
    const [broken] = await db.insert(pageVersions).values({ projectId: project.id, pageId: home.id, versionNumber: 92, sourceCode: `export default function Page(){const count: number = "not a number";return <main className="c-page">{count}</main>}`, manifest: version!.manifest, seoMetadata: {}, changeSummary: {}, sourceHash: "f".repeat(64), createdByUserId: owner.id }).returning();
    await db.update(pageNodes).set({ currentVersionId: broken!.id }).where(eq(pageNodes.id, home.id));

    const { service, jobId, state } = await exportProject(owner.id, project.id);
    expect(state.status).toBe("failed");
    expect(state.errorCode).toBe("EXPORT_BUILD_FAILED");
    expect(state.validation?.failures[0]?.code).toBe("EXPORT_TYPECHECK_FAILED");
    await expect(service.download(owner.id, project.id, jobId)).rejects.toMatchObject({ exportCode: "EXPORT_NOT_READY" });
  });

  it("isolates export jobs and downloads to their own project and members", async () => {
    const { owner, project, home } = await setup();
    await runPageJob(owner.id, project.id, home.id, `export default function Page(){return <main className="c-page"><h1>Home</h1></main>}`);
    const { jobId } = await exportProject(owner.id, project.id);

    const stranger = await makeUser("stranger");
    const otherWorkspace = await new WorkspaceService().create(stranger.id, { name: "Other" });
    const otherProject = await new ProjectService().create(stranger.id, { workspaceId: otherWorkspace.id, name: "Other Site" });
    const service = new ExportService();

    for (const attempt of [
      () => service.get(stranger.id, project.id, jobId),
      () => service.download(stranger.id, project.id, jobId),
      () => service.list(stranger.id, project.id),
      () => service.create(stranger.id, project.id),
    ]) await expect(attempt()).rejects.toThrow(/do not have access/);
    // A guessed export ID cannot be reached through a project the caller does own.
    await expect(service.get(stranger.id, otherProject.id, jobId)).rejects.toMatchObject({ exportCode: "EXPORT_NOT_FOUND" });
    await expect(service.download(stranger.id, otherProject.id, jobId)).rejects.toMatchObject({ exportCode: "EXPORT_NOT_FOUND" });
  });

  it("allows one export at a time per project and keeps history", async () => {
    const { owner, project, home } = await setup();
    await runPageJob(owner.id, project.id, home.id, `export default function Page(){return <main className="c-page"><h1>Home</h1></main>}`);
    const service = new ExportService();
    const first = await service.create(owner.id, project.id);
    await expect(service.create(owner.id, project.id)).rejects.toMatchObject({ exportCode: "EXPORT_ACTIVE" });
    await service.process(first.id);
    const second = await service.create(owner.id, project.id);
    await service.process(second.id);
    const listed = await service.list(owner.id, project.id);
    expect(listed).toHaveLength(2);
    expect(listed.every((job) => job.status === "completed")).toBe(true);
  });
});
