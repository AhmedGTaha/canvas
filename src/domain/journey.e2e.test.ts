import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { inflateRawSync } from "node:zlib";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, sql } from "@/server/db/client";
import { buildingBlockUsages, pageNodes, pageVersions } from "@/server/db/schema";
import { authenticate, register } from "@/domain/auth/service";
import { WorkspaceService } from "@/domain/workspaces/service";
import { ProjectService } from "@/domain/projects/service";
import { BrandService, ThemeService } from "@/domain/theme/services";
import { MediaService } from "@/domain/media/service";
import { PageTreeService } from "@/domain/pages/service";
import { BuildingBlockService } from "@/domain/blocks/service";
import { GenerationJobService, claimGenerationJob } from "@/domain/ai/job-service";
import { AIOrchestrationService } from "@/domain/ai/orchestration-service";
import type { AIProvider, AIRequest, AIResponse, StructuredValidator } from "@/domain/ai/provider";
import { InvitationService } from "@/domain/collaboration/invitation-service";
import { HistoryService } from "@/domain/history/undo-service";
import { VersionRestoreService } from "@/domain/history/restore-service";
import { CheckpointService } from "@/domain/history/checkpoint-service";
import { ExportService } from "@/domain/export/export-service";
import { PreviewManifestService } from "@/generated-runtime/manifest/service";
import { GeneratedPageContentProvider } from "@/generated-runtime/preview/generated-page-provider";
import { renderPreviewDocument } from "@/generated-runtime/preview/render-document";
import { initialPreviewRoute } from "@/generated-runtime/runtime/router";
import { DEFAULT_THEME } from "@/domain/theme/defaults";
import { fixtureProviderResolver } from "@/domain/ai/testing/provider-fixtures";

/** Media as the sandboxed Preview resolves it: a session URL, never a storage key. */
const previewMedia = (mediaId: string) => ({ url: `/api/preview/media/${mediaId}`, width: 800, height: 600, altText: null });


const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
/** Set CANVAS_E2E_BUILD=1 to also npm install and next build the exported project. */
const RUN_STANDALONE_BUILD = process.env.CANVAS_E2E_BUILD === "1";

type FixtureOptions = { blockUsages?: Array<{ blockId: string; usageKey: string }>; referencedMediaIds?: string[]; targetCanvasId?: string | null };
class FixtureProvider implements AIProvider { readonly capabilities = { structuredOutput: true, vision: true };
  name = "fixture"; model = "fixture-1";
  constructor(private readonly source: string, private readonly options: FixtureOptions = {}) {}
  async generateText(): Promise<AIResponse> { return { text: "", provider: this.name, model: this.model }; }
  async generateStructured<T>(_request: AIRequest, validator: StructuredValidator<T>): Promise<AIResponse<T>> {
    const value = {
      schemaVersion: 1, html: this.source, referencedMediaIds: this.options.referencedMediaIds ?? [],
      ...(this.options.blockUsages?.length ? { blockUsages: this.options.blockUsages } : {}),
      ...(this.options.targetCanvasId === undefined ? {} : { targetCanvasId: this.options.targetCanvasId }),
      summary: { headline: "Applied", changes: ["Updated the website"], limitations: [] },
    };
    return { text: "", structuredData: validator.parse(value), provider: this.name, model: this.model };
  }
}
async function runPageJob(userId: string, projectId: string, pageId: string, prompt: string, source: string, options: FixtureOptions & { selection?: { canvasId: string } } = {}) {
  const { selection, ...fixture } = options;
  const request = await new GenerationJobService().createPageJob(userId, { projectId, pageId, content: prompt, selectedMediaIds: [], selection: selection ?? null });
  await claimGenerationJob("e2e");
  const job = await new AIOrchestrationService(db, undefined, undefined, fixtureProviderResolver(() => new FixtureProvider(source, fixture))).process(request.job.id);
  expect(job, `page job for ${prompt}`).toMatchObject({ status: "completed" });
}
async function runBlockJob(userId: string, projectId: string, blockId: string, prompt: string, source: string, options: FixtureOptions = {}) {
  const request = await new GenerationJobService().createBlockJob(userId, { projectId, blockId, content: prompt, selectedMediaIds: [] });
  await claimGenerationJob("e2e");
  const job = await new AIOrchestrationService(db, undefined, undefined, fixtureProviderResolver(() => new FixtureProvider(source, options))).process(request.job.id);
  expect(job, `block job for ${prompt}`).toMatchObject({ status: "completed" });
}
function readZip(archive: Uint8Array) {
  const buffer = Buffer.from(archive);
  const endIndex = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buffer.readUInt16LE(endIndex + 10);
  let cursor = buffer.readUInt32LE(endIndex + 16);
  const files = new Map<string, Buffer>();
  for (let index = 0; index < count; index += 1) {
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    const start = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const body = buffer.subarray(start, start + compressedSize);
    files.set(name, method === 8 ? inflateRawSync(body) : Buffer.from(body));
    cursor += 46 + nameLength + buffer.readUInt16LE(cursor + 30) + buffer.readUInt16LE(cursor + 32);
  }
  return files;
}
function run(command: string, args: string[], cwd: string) {
  return new Promise<{ code: number; output: string }>((resolve) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", CI: "1" } });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
    child.on("error", (error) => resolve({ code: 1, output: error.message }));
  });
}

/**
 * The SRS critical journey, start to finish, against the real service layer with a
 * deterministic AI provider. Each step asserts the user-visible outcome of the step
 * before the next one begins.
 */
// The end-to-end journey performs several real generation transitions.
describe.sequential("Canvas critical journey", { timeout: 120_000 }, () => {
  process.env.PREVIEW_TOKEN_SECRET = "journey-e2e-preview-secret-value-long-enough";
  const state: Record<string, string> = {};
  let archive: Uint8Array | null = null;

  beforeAll(async () => { await sql`TRUNCATE TABLE export_jobs, project_checkpoint_items, project_checkpoints, change_set_items, change_sets, building_block_usages, building_block_versions, building_blocks, generation_job_media, page_versions, ai_job_rate_limits, generation_jobs, ai_messages, ai_conversations, project_instructions, media_assets, media_folders, page_nodes, audit_events, editing_leases, project_invites, project_members, auth_rate_limits, sessions, auth_credentials, projects, workspaces, users RESTART IDENTITY CASCADE`; });
  afterAll(async () => {
    await rm(path.resolve(process.cwd(), process.env.LOCAL_STORAGE_PATH || ".canvas-storage", "projects"), { recursive: true, force: true });
    await sql.end();
  });

  it("1. signs up and signs back in", async () => {
    const email = `founder-${randomUUID()}@test.dev`;
    const registered = await register({ email, password: "a strong founder password", displayName: "Founder" });
    expect(registered.email).toBe(email);
    const signedIn = await authenticate({ email, password: "a strong founder password" });
    expect(signedIn.id).toBe(registered.id);
    await expect(authenticate({ email, password: "wrong password" })).rejects.toThrow(/incorrect/i);
    state.ownerId = registered.id; state.ownerEmail = email;
  });

  it("2. creates a workspace and project", async () => {
    const workspace = await new WorkspaceService().create(state.ownerId!, { name: "Acme Workspace" });
    const project = await new ProjectService().create(state.ownerId!, { workspaceId: workspace.id, name: "Acme Site" });
    expect((await new ProjectService().listAccessible(state.ownerId!)).owned).toHaveLength(1);
    state.projectId = project.id;
  });

  it("3. configures company identity and theme", async () => {
    const brand = new BrandService(); const theme = new ThemeService();
    const currentBrand = await brand.read(state.ownerId!, state.projectId!);
    await brand.update(state.ownerId!, { projectId: state.projectId!, expectedRevision: currentBrand.revision, brand: { companyName: "Acme", companyDescription: "Industrial supplies since 1947.", brandNotes: "Confident, plain-spoken." } });
    const currentTheme = await theme.read(state.ownerId!, state.projectId!);
    await theme.update(state.ownerId!, { projectId: state.projectId!, expectedRevision: currentTheme.revision, theme: { ...DEFAULT_THEME, lightTokens: { ...DEFAULT_THEME.lightTokens, accent: "#0F62FE" }, radiusScale: 70 } });

    expect(await brand.read(state.ownerId!, state.projectId!)).toMatchObject({ companyName: "Acme" });
    const updated = await theme.read(state.ownerId!, state.projectId!);
    expect(updated.lightTokens.accent).toBe("#0F62FE");
    expect(updated.resolvedDesignTokens.radius.lg).not.toBe("");
  });

  it("4. uploads media", async () => {
    const asset = await new MediaService().upload(state.ownerId!, { projectId: state.projectId!, folderId: null, filename: "acme-logo.png", bytes: new Uint8Array(PNG) });
    expect(asset).toMatchObject({ displayName: "acme-logo", mimeType: "image/png" });
    await new MediaService().setBrandLogo(state.ownerId!, { projectId: state.projectId!, kind: "primary", assetId: asset.id });
    state.mediaId = asset.id;
  });

  it("5. builds the page tree", async () => {
    const pages = new PageTreeService();
    const home = await pages.create(state.ownerId!, { projectId: state.projectId!, type: "page", name: "Home" });
    const contact = await pages.create(state.ownerId!, { projectId: state.projectId!, type: "page", name: "Contact" });
    await pages.updateSeo(state.ownerId!, { projectId: state.projectId!, nodeId: contact.id, pageTitle: "Contact Acme", metaDescription: "Talk to the Acme team." });
    const tree = await pages.listTree(state.ownerId!, state.projectId!);
    expect(tree.map((node) => node.routePath).sort()).toEqual(["/", "/contact"]);
    state.homeId = home.id; state.contactId = contact.id;
  });

  it("6. generates the Home page with Canvas", async () => {
    const source = `<main class="c-page"><section data-canvas-id="hero-main" data-canvas-label="Hero" class="c-section c-container"><img data-canvas-media="${state.mediaId}" alt="Acme" class="c-media"><h1>Industrial supplies since 1947</h1></section><article data-canvas-id="pricing-card" class="c-card"><p>Spacious plan details</p></article></main>`;
    await runPageJob(state.ownerId!, state.projectId!, state.homeId!, "Create the homepage", source, { referencedMediaIds: [state.mediaId!] });
    const [node] = await db.select().from(pageNodes).where(eq(pageNodes.id, state.homeId!));
    expect(node?.currentVersionId).toBeTruthy();
  });

  it("7. previews the site across desktop, tablet, and mobile", async () => {
    const session = await new PreviewManifestService().createSession(state.ownerId!, state.projectId!);
    expect(session.manifest.pages).toHaveLength(2);
    const route = initialPreviewRoute(session.manifest);
    const generated = await new GeneratedPageContentProvider().get(state.projectId!, state.homeId!, session.manifest.pages.find((page) => page.pageId === state.homeId)!.currentVersionId!, previewMedia);
    expect(generated?.composed.html).toContain("Industrial supplies since 1947");
    // The preview document is identical across device modes: only the parent frame resizes.
    const documents = (["desktop", "tablet", "mobile"] as const).map(() => renderPreviewDocument({ manifest: session.manifest, nonce: "nonce", parentOrigin: "http://localhost:3000", instanceId: randomUUID(), initialRoute: route, initialMode: "light", generated: generated!.composed }));
    for (const document of documents) {
      expect(document).toContain("generated-root");
      expect(document).toContain("width=device-width,initial-scale=1");
      expect(document).toContain("handleSelectionMessage");
    }
    state.previewRevision = session.manifest.previewRevision;
  });

  it("8. creates a global Navbar building block", async () => {
    const navbar = await new BuildingBlockService().create(state.ownerId!, { projectId: state.projectId!, name: "Global Navbar", kind: "navbar", isGlobal: true });
    await runBlockJob(state.ownerId!, state.projectId!, navbar.id, "Create a navbar with my logo and pages",
      `<nav data-canvas-id="navbar-root" class="c-container" aria-label="Main"><img data-canvas-media="${state.mediaId}" alt="Acme" class="c-media"><a href="/">Home</a><a href="/contact">Contact</a></nav>`,
      { referencedMediaIds: [state.mediaId!] });
    state.navbarId = navbar.id;

    const usage = [{ blockId: navbar.id, usageKey: "site-navbar" }];
    await runPageJob(state.ownerId!, state.projectId!, state.homeId!, "Use the navbar", `<main class="c-page"><div data-canvas-block="${navbar.id}" data-canvas-usage="site-navbar"></div><section data-canvas-id="hero-main" class="c-section c-container"><h1>Industrial supplies since 1947</h1></section><article data-canvas-id="pricing-card" class="c-card"><p>Spacious plan details</p></article></main>`, { blockUsages: usage });
    expect(await db.select().from(buildingBlockUsages)).toHaveLength(1);
  });

  it("9. creates another page that reuses the global navbar", async () => {
    const usage = [{ blockId: state.navbarId!, usageKey: "site-navbar" }];
    await runPageJob(state.ownerId!, state.projectId!, state.contactId!, "Build the contact page with the navbar", `<main class="c-page"><div data-canvas-block="${state.navbarId}" data-canvas-usage="site-navbar"></div><section data-canvas-id="contact-form" class="c-section c-container"><h1>Contact Acme</h1></section></main>`, { blockUsages: usage });
    expect(await db.select().from(buildingBlockUsages)).toHaveLength(2);
  });

  it("10. updates the navbar from the page tree and propagates it everywhere", async () => {
    await runBlockJob(state.ownerId!, state.projectId!, state.navbarId!, "Rename the Contact link and tighten spacing",
      `<nav data-canvas-id="navbar-root" class="c-container" aria-label="Main"><img data-canvas-media="${state.mediaId}" alt="Acme" class="c-media"><a href="/">Home</a><a href="/contact">Contact us</a></nav>`,
      { referencedMediaIds: [state.mediaId!] });
    const pageVersionCount = (await db.select().from(pageVersions)).length;
    for (const pageId of [state.homeId!, state.contactId!]) {
      const [node] = await db.select().from(pageNodes).where(eq(pageNodes.id, pageId));
      const rendered = await new GeneratedPageContentProvider().get(state.projectId!, pageId, node!.currentVersionId!, previewMedia);
      expect(rendered?.composed.html).toContain("Contact us");
    }
    // Propagation never rewrites page source.
    expect((await db.select().from(pageVersions)).length).toBe(pageVersionCount);
  });

  it("11. selects an element and modifies just that element", async () => {
    const before = await new VersionRestoreService().listPageVersions(state.ownerId!, state.projectId!, state.homeId!);
    await runPageJob(state.ownerId!, state.projectId!, state.homeId!, "Make this card more compact",
      `<main class="c-page"><div data-canvas-block="${state.navbarId}" data-canvas-usage="site-navbar"></div><section data-canvas-id="hero-main" class="c-section c-container"><h1>Industrial supplies since 1947</h1></section><article data-canvas-id="pricing-card" class="c-card"><p>Compact plan details</p></article></main>`,
      { blockUsages: [{ blockId: state.navbarId!, usageKey: "site-navbar" }], selection: { canvasId: "pricing-card" }, targetCanvasId: "pricing-card" });

    const after = await new VersionRestoreService().listPageVersions(state.ownerId!, state.projectId!, state.homeId!);
    expect(after.versions.length).toBe(before.versions.length + 1);
    const [node] = await db.select().from(pageNodes).where(eq(pageNodes.id, state.homeId!));
    const [version] = await db.select().from(pageVersions).where(eq(pageVersions.id, node!.currentVersionId!));
    expect(version?.document as { html: string }).toMatchObject({ html: expect.stringContaining("Compact plan details") });
    // The untouched hero survives the targeted edit.
    expect(version?.document as { html: string }).toMatchObject({ html: expect.stringContaining("Industrial supplies since 1947") });
    state.homeVersionBeforeUndo = node!.currentVersionId!;
  });

  it("12. undoes the element edit", async () => {
    const result = await new HistoryService().undo(state.ownerId!, state.projectId!);
    expect(result.source.operation).toBe("page_modify");
    const [node] = await db.select().from(pageNodes).where(eq(pageNodes.id, state.homeId!));
    const [version] = await db.select().from(pageVersions).where(eq(pageVersions.id, node!.currentVersionId!));
    expect(version?.document as { html: string }).toMatchObject({ html: expect.stringContaining("Spacious plan details") });
    expect(node?.currentVersionId).not.toBe(state.homeVersionBeforeUndo);
  });

  it("13. redoes the element edit", async () => {
    expect((await new HistoryService().state(state.ownerId!, state.projectId!)).redo).not.toBeNull();
    await new HistoryService().redo(state.ownerId!, state.projectId!);
    const [node] = await db.select().from(pageNodes).where(eq(pageNodes.id, state.homeId!));
    expect(node?.currentVersionId).toBe(state.homeVersionBeforeUndo);
    expect(await new GeneratedPageContentProvider().get(state.projectId!, state.homeId!, node!.currentVersionId!, previewMedia).then((result) => result?.composed.html)).toContain("Compact plan details");
  });

  it("14. creates a named checkpoint, which clears the pending-change count", async () => {
    const before = await new HistoryService().state(state.ownerId!, state.projectId!);
    expect(before.lastCheckpointAt).toBeNull();
    // Every change so far is uncheckpointed, and there have been more than the
    // capped history window would show.
    expect(before.pendingChanges).toBeGreaterThan(0);

    const checkpoint = await new CheckpointService().create(state.ownerId!, { projectId: state.projectId!, name: "Before collaborator review" });
    expect(await new CheckpointService().list(state.ownerId!, state.projectId!)).toMatchObject([{ name: "Before collaborator review", pageCount: 2, blockCount: 1 }]);
    state.checkpointId = checkpoint.id;

    const after = await new HistoryService().state(state.ownerId!, state.projectId!);
    expect(after.lastCheckpointAt).not.toBeNull();
    expect(after.pendingChanges).toBe(0);
  });

  it("15. invites a collaborator who accepts", async () => {
    const collaborator = await register({ email: `mate-${randomUUID()}@test.dev`, password: "another strong password", displayName: "Teammate" });
    const invites = new InvitationService();
    const { token } = await invites.create(state.ownerId!, { projectId: state.projectId! });
    expect(await invites.preview(token)).toMatchObject({ projectId: state.projectId });
    await invites.accept(collaborator.id, { token });
    expect((await new ProjectService().listAccessible(collaborator.id)).shared).toHaveLength(1);
    state.collaboratorId = collaborator.id;
  });

  it("16. lets the collaborator edit another page", async () => {
    await runPageJob(state.collaboratorId!, state.projectId!, state.contactId!, "Add opening hours",
      `<main class="c-page"><div data-canvas-block="${state.navbarId}" data-canvas-usage="site-navbar"></div><section data-canvas-id="contact-form" class="c-section c-container"><h1>Contact Acme</h1><p>Open weekdays 9 to 5.</p></section></main>`,
      { blockUsages: [{ blockId: state.navbarId!, usageKey: "site-navbar" }] });
    const contactVersions = await new VersionRestoreService().listPageVersions(state.ownerId!, state.projectId!, state.contactId!);
    expect(contactVersions.versions[0]).toMatchObject({ actor: "Teammate", isCurrent: true });
    expect(contactVersions.versions).toHaveLength(2);
    // A collaborator's work counts towards the project's pending changes too.
    expect((await new HistoryService().state(state.ownerId!, state.projectId!)).pendingChanges).toBe(1);
  });

  it("17. browses version history, restores a version, then restores the checkpoint", async () => {
    const versions = new VersionRestoreService();
    const history = await versions.listPageVersions(state.ownerId!, state.projectId!, state.contactId!);
    const previous = history.versions.find((version) => !version.isCurrent)!;
    await versions.restorePageVersion(state.ownerId!, state.projectId!, state.contactId!, previous.id);
    const [contact] = await db.select().from(pageNodes).where(eq(pageNodes.id, state.contactId!));
    expect(contact?.currentVersionId).toBe(previous.id);
    // Restoring never deletes the newer version.
    expect((await versions.listPageVersions(state.ownerId!, state.projectId!, state.contactId!)).versions).toHaveLength(2);

    const restored = await new CheckpointService().restore(state.ownerId!, state.projectId!, state.checkpointId!);
    expect(restored.skipped).toEqual([]);
    const [contactAfter] = await db.select().from(pageNodes).where(eq(pageNodes.id, state.contactId!));
    expect(contactAfter?.currentVersionId).toBe(history.versions.find((version) => version.versionNumber === 1)!.id);
    // A collaborator's newer version is preserved for later restore.
    expect((await versions.listPageVersions(state.ownerId!, state.projectId!, state.contactId!)).versions).toHaveLength(2);
  });

  it("18. exports a validated ZIP", async () => {
    const service = new ExportService();
    const job = await service.create(state.ownerId!, state.projectId!);
    await service.process(job.id);
    const result = await service.get(state.ownerId!, state.projectId!, job.id);
    expect(result).toMatchObject({ status: "completed", validation: { ok: true } });

    const artifact = await service.download(state.ownerId!, state.projectId!, job.id);
    archive = artifact.bytes;
    const files = readZip(artifact.bytes);
    for (const required of ["package.json", "tsconfig.json", "next.config.mjs", "README.md", "styles/globals.css", "app/layout.tsx", "app/page.tsx", "app/contact/page.tsx"]) {
      expect(files.has(required), `${required} missing from export`).toBe(true);
    }
    expect([...files.keys()].filter((name) => name.startsWith("components/blocks/"))).toHaveLength(1);
    expect([...files.keys()].filter((name) => name.startsWith("public/assets/"))).toHaveLength(1);
    const combined = [...files.entries()].filter(([name]) => !name.startsWith("public/")).map(([, contents]) => contents.toString("utf8")).join("\n");
    for (const secret of ["data-canvas-", "@canvas/site-runtime", state.projectId!, state.navbarId!, state.mediaId!, "PREVIEW_TOKEN_SECRET", "DATABASE_URL"]) {
      expect(combined, `export leaked ${secret}`).not.toContain(secret);
    }
    expect(files.get("app/contact/page.tsx")!.toString("utf8")).toContain('title: "Contact Acme"');
  });

  it.runIf(RUN_STANDALONE_BUILD)("19. unzips and production-builds the exported project", async () => {
    expect(archive).toBeTruthy();
    const directory = await mkdtemp(path.join(tmpdir(), "canvas-journey-"));
    try {
      for (const [name, contents] of readZip(archive!)) {
        const target = path.join(directory, name);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, contents);
      }
      const install = await run("npm", ["install", "--no-audit", "--no-fund"], directory);
      expect(install.code, install.output.slice(-800)).toBe(0);
      const build = await run("npm", ["run", "build"], directory);
      expect(build.code, build.output.slice(-1500)).toBe(0);
      expect(build.output).toMatch(/Compiled successfully/);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 600_000);
});
