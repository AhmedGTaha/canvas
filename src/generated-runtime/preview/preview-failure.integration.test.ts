import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { Script } from "node:vm";
import { JSDOM } from "jsdom";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, sql } from "@/server/db/client";
import { buildingBlockVersions, buildingBlocks, mediaAssets, pageNodes, pageVersions, projectBrandSettings, users } from "@/server/db/schema";
import { WorkspaceService } from "@/domain/workspaces/service";
import { ProjectService } from "@/domain/projects/service";
import { PageTreeService } from "@/domain/pages/service";
import { BuildingBlockService } from "@/domain/blocks/service";
import { GenerationJobService, claimGenerationJob } from "@/domain/ai/job-service";
import { AIOrchestrationService } from "@/domain/ai/orchestration-service";
import { fixtureProviderResolver } from "@/domain/ai/testing/provider-fixtures";
import type { AIProvider, AIRequest, AIResponse, StructuredValidator } from "@/domain/ai/provider";
import { getObjectStorage } from "@/server/storage";
import { PreviewManifestService } from "@/generated-runtime/manifest/service";
import { PreviewTokenService } from "@/generated-runtime/security/preview-token";
import { BuildingBlockContentProvider } from "@/domain/blocks/preview";
import { GeneratedPageContentProvider } from "@/generated-runtime/preview/generated-page-provider";
import { renderBlockPreviewDocument, renderPreviewDocument, renderPreviewErrorDocument } from "@/generated-runtime/preview/render-document";
import { validateGeneratedBlockDocument } from "@/domain/blocks/validation";
import { PreviewError } from "@/generated-runtime/preview/errors";
import { setTelemetrySink } from "@/server/observability/telemetry";
import { ThemeService } from "@/domain/theme/services";
import { DEFAULT_THEME } from "@/domain/theme/defaults";
import { ProjectContextBuilder } from "@/domain/ai/context";
import { generatedThemeCss } from "./runtime-css";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const PREVIEW_SECRET = "preview-failure-suite-secret-value-long-enough";
const MEDIA_PLACEHOLDER = "__MEDIA_ID__";

/** Media as the sandboxed Preview resolves it: a session URL, never a storage key. */
const previewMedia = (id: string) => ({ url: `/api/preview/media/${id}`, width: 40, height: 40, altText: "Logo" });
/** A generated fragment as the provider fixtures return it. */
type Fragment = { html: string; css?: string; js?: string };

function expectPreviewScriptsToParse(document: string) {
  const scripts = [...document.matchAll(/<script nonce="[^"]+">([\s\S]*?)<\/script>/g)].map((match) => match[1]!);
  expect(scripts.length).toBeGreaterThan(0);
  for (const script of scripts) expect(() => new Script(script)).not.toThrow();
}

async function expectPreviewScriptsToRender(document: string, text: string) {
  const dom = new JSDOM(document, { runScripts: "outside-only", url: "http://localhost/preview" });
  const scripts = [...document.matchAll(/<script nonce="[^"]+">([\s\S]*?)<\/script>/g)].map((match) => match[1]!);
  for (const script of scripts) dom.window.eval(script);
  await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 50));
  expect(dom.window.document.getElementById("generated-root")?.textContent).toContain(text);
  dom.window.close();
}

/**
 * The shape a real provider returns for a Building Block: markup that leans on the shared
 * Canvas classes, a small stylesheet of its own, and a little behaviour — the three
 * artifacts of the document contract, kept apart.
 */
const GEMINI_NAVBAR: Fragment = {
  html: `<nav class="c-navbar" data-canvas-id="navbar-root" data-canvas-label="Navbar">
      <div class="c-container c-cluster">
        <a href="#" data-canvas-id="navbar-logo" data-canvas-label="Logo" class="c-nav-brand">
          <img data-canvas-media="${MEDIA_PLACEHOLDER}" alt="Company logo" class="c-logo" width="40" height="40">
        </a>
        <button type="button" class="c-button-secondary nav-toggle" aria-expanded="false" aria-controls="nav-menu">Menu</button>
        <ul class="c-nav-links nav-menu" id="nav-menu" data-canvas-id="navbar-links" data-canvas-label="Navigation Links" hidden>
          <li><a href="#" class="c-link">Home</a></li>
          <li><a href="#" class="c-link">About</a></li>
        </ul>
        <div data-canvas-id="navbar-cta" data-canvas-label="Call to Action">
          <a href="#" class="c-button">Get Started</a>
        </div>
      </div>
    </nav>`,
  css: `.nav-menu{list-style:none;margin:0;padding:0}`,
  js: `var toggle = document.querySelector(".nav-toggle");
var menu = document.getElementById("nav-menu");
if (toggle && menu) toggle.addEventListener("click", function () {
  var open = toggle.getAttribute("aria-expanded") === "true";
  toggle.setAttribute("aria-expanded", open ? "false" : "true");
  if (open) menu.setAttribute("hidden", ""); else menu.removeAttribute("hidden");
});`,
};

const withMedia = (fragment: Fragment, mediaId: string): Fragment => ({ ...fragment, html: fragment.html.replace(MEDIA_PLACEHOLDER, mediaId) });

class FixtureProvider implements AIProvider { readonly capabilities = { structuredOutput: true, vision: true };
  name = "fixture"; model = "fixture-1";
  constructor(private readonly fragment: Fragment, private readonly options: { referencedMediaIds?: string[]; blockUsages?: Array<{ blockId: string; usageKey: string }> } = {}) {}
  async generateText(): Promise<AIResponse> { return { text: "", provider: this.name, model: this.model }; }
  async generateStructured<T>(_request: AIRequest, validator: StructuredValidator<T>): Promise<AIResponse<T>> {
    const value = {
      // A Building Block response carries no page metadata, so the fixture sends the
      // same three artifacts a real provider does and nothing more.
      schemaVersion: 1, html: this.fragment.html, css: this.fragment.css ?? "", js: this.fragment.js ?? "",
      referencedMediaIds: this.options.referencedMediaIds ?? [],
      ...(this.options.blockUsages?.length ? { blockUsages: this.options.blockUsages } : {}),
      summary: { headline: "Created the navbar", changes: ["Added navigation"], limitations: [] },
    };
    return { text: "", structuredData: validator.parse(value), provider: this.name, model: this.model, providerRequestId: "fixture-response-id", usage: { inputTokens: 120, outputTokens: 340, totalTokens: 460 } };
  }
}
async function makeUser(label: string) { const id = randomUUID(); const [record] = await db.insert(users).values({ id, email: `${label}-${id}@test.dev`, normalizedEmail: `${label}-${id}@test.dev`, displayName: label }).returning(); return record!; }
async function setup() {
  const owner = await makeUser("owner");
  const workspace = await new WorkspaceService().create(owner.id, { name: "Workspace" });
  const project = await new ProjectService().create(owner.id, { workspaceId: workspace.id, name: "Site" });
  const home = await new PageTreeService().create(owner.id, { projectId: project.id, type: "page", name: "Home" });
  const storageKey = `test-preview/${randomUUID()}.png`;
  await getObjectStorage().put(storageKey, PNG);
  const [asset] = await db.insert(mediaAssets).values({ projectId: project.id, originalFilename: "logo.png", displayName: "Logo", storageKey, mimeType: "image/png", sizeBytes: PNG.length, width: 40, height: 40, altText: "Logo", createdByUserId: owner.id }).returning();
  await db.update(projectBrandSettings).set({ primaryLogoMediaId: asset!.id }).where(eq(projectBrandSettings.projectId, project.id));
  return { owner, project, home, mediaId: asset!.id };
}
async function runBlockJob(userId: string, projectId: string, blockId: string, fragment: Fragment, mediaIds: string[]) {
  const job = await processBlockJob(userId, projectId, blockId, fragment, mediaIds);
  expect(job).toMatchObject({ status: "completed", errorCode: null, errorDiagnostic: null });
}
async function processBlockJob(userId: string, projectId: string, blockId: string, fragment: Fragment, mediaIds: string[]) {
  const request = await new GenerationJobService().createBlockJob(userId, { projectId, blockId, content: "Create a navbar", selectedMediaIds: mediaIds });
  await claimGenerationJob("worker");
  return new AIOrchestrationService(db, undefined, undefined, fixtureProviderResolver(() => new FixtureProvider(fragment, { referencedMediaIds: mediaIds }))).process(request.job.id);
}
async function runPageJob(userId: string, projectId: string, pageId: string, fragment: Fragment, blockUsages: Array<{ blockId: string; usageKey: string }>) {
  const request = await new GenerationJobService().createPageJob(userId, { projectId, pageId, content: "Use the navbar", selectedMediaIds: [] });
  await claimGenerationJob("worker");
  const job = await new AIOrchestrationService(db, undefined, undefined, fixtureProviderResolver(() => new FixtureProvider(fragment, { blockUsages }))).process(request.job.id);
  expect(job).toMatchObject({ status: "completed", errorCode: null, errorDiagnostic: null });
}
const environment = { ...process.env };

// These fixtures include real generated-version transitions before rendering.
describe.sequential("Preview failure handling", { timeout: 120_000 }, () => {
  beforeEach(async () => {
    process.env.PREVIEW_TOKEN_SECRET = PREVIEW_SECRET;
    await sql`TRUNCATE TABLE export_jobs, project_checkpoint_items, project_checkpoints, change_set_items, change_sets, building_block_usages, building_block_versions, building_blocks, generation_job_media, page_versions, ai_job_rate_limits, generation_jobs, ai_messages, ai_conversations, project_instructions, media_assets, media_folders, page_nodes, audit_events, editing_leases, project_invites, project_members, auth_rate_limits, sessions, auth_credentials, projects, workspaces, users RESTART IDENTITY CASCADE`;
  });
  afterEach(() => { process.env = { ...environment }; setTelemetrySink(null); });
  afterAll(async () => {
    await rm(path.resolve(process.cwd(), process.env.LOCAL_STORAGE_PATH || ".canvas-storage", "test-preview"), { recursive: true, force: true });
    await sql.end();
  });

  it("previews a real Gemini-generated global navbar as a Building Block", async () => {
    const { owner, project, mediaId } = await setup();
    const fragment = withMedia(GEMINI_NAVBAR, mediaId);
    const navbar = await new BuildingBlockService().create(owner.id, { projectId: project.id, name: "Global navbar", kind: "navbar", isGlobal: true });
    await runBlockJob(owner.id, project.id, navbar.id, fragment, [mediaId]);

    // The version that activation produced is the version Preview compiles.
    const [version] = await db.select().from(buildingBlockVersions).where(eq(buildingBlockVersions.buildingBlockId, navbar.id));
    expect((version?.document as { html: string }).html).toContain("navbar-root");
    expect(version?.sourceFormat).toBe("static_html");
    const composed = await new BuildingBlockContentProvider().getActive(project.id, navbar.id, previewMedia);
    expect(composed?.composed.html).toContain("navbar-root");
    expect(composed?.composed.js).toContain("aria-expanded");
    expect(composed?.version.id).toBe(version!.id);

    const session = await new PreviewManifestService().createSession(owner.id, project.id);
    const document = renderBlockPreviewDocument({ manifest: session.manifest, nonce: "nonce", parentOrigin: "http://localhost:3000", instanceId: randomUUID(), initialMode: "light", block: { id: navbar.id, name: "Global navbar", contentStatus: "generated" }, generated: composed!.composed });
    expect(document).toContain("generated-root");
    expect(document).toContain("Get Started");
    expectPreviewScriptsToParse(document);
    await expectPreviewScriptsToRender(document, "Get Started");
    // The referenced Media resolves through the manifest, not a storage key.
    expect(session.manifest.media[mediaId]?.previewUrl).toMatch(/^\/api\/preview\/media\//);
    // Media resolves to the session URL, and the raw storage key never appears.
    expect(document).toContain(`/api/preview/media/${mediaId}`);
  });

  it("renders the same block inside a Page Preview that uses it globally", async () => {
    const { owner, project, home, mediaId } = await setup();
    const navbar = await new BuildingBlockService().create(owner.id, { projectId: project.id, name: "Global navbar", kind: "navbar", isGlobal: true });
    await runBlockJob(owner.id, project.id, navbar.id, withMedia(GEMINI_NAVBAR, mediaId), [mediaId]);
    await runPageJob(owner.id, project.id, home.id, { html: `<main class="c-page" data-canvas-id="page"><div data-canvas-block="${navbar.id}" data-canvas-usage="site-navbar"></div><h1>Home</h1></main>` }, [{ blockId: navbar.id, usageKey: "site-navbar" }]);

    const [node] = await db.select().from(pageNodes).where(eq(pageNodes.id, home.id));
    const generated = await new GeneratedPageContentProvider().get(project.id, home.id, node!.currentVersionId!, previewMedia);
    expect(generated?.composed.html).toContain("Get Started");
    expect(generated?.composed.html).toContain("navbar-root");
    // The block's own stylesheet arrives scoped to its host rather than global.
    expect(generated?.composed.css).toMatch(/\.cb-[0-9a-f]{8} \.nav-menu/);

    const session = await new PreviewManifestService().createSession(owner.id, project.id);
    const document = renderPreviewDocument({ manifest: session.manifest, nonce: "nonce", parentOrigin: "http://localhost:3000", instanceId: randomUUID(), initialRoute: "/", initialMode: "light", generated: generated!.composed });
    expect(document).toContain("generated-root");
    expect(document).toContain("Get Started");
    expectPreviewScriptsToParse(document);
    await expectPreviewScriptsToRender(document, "Get Started");
  });

  it("uses current theme tokens in Block and Page Preview without regenerating existing versions", async () => {
    const { owner, project, home, mediaId } = await setup();
    await new PageTreeService().create(owner.id, { projectId: project.id, type: "page", name: "About" });
    await new PageTreeService().create(owner.id, { projectId: project.id, type: "page", name: "Contact" });
    const navbar = await new BuildingBlockService().create(owner.id, { projectId: project.id, name: "Global navbar", kind: "navbar", isGlobal: true });
    const themes = new ThemeService();
    const initial = await themes.read(owner.id, project.id);
    const firstTheme = await themes.update(owner.id, {
      projectId: project.id,
      expectedRevision: initial.revision,
      theme: {
        ...DEFAULT_THEME,
        lightTokens: { ...DEFAULT_THEME.lightTokens, primary: "#123456", text: "#234567", surface: "#345678" },
        darkTokens: { ...DEFAULT_THEME.darkTokens, primary: "#ABCDEF", text: "#BCDEF0", surface: "#0A1B2C" },
        radiusScale: 20, spacingScale: 30, shadowScale: 40, fontScale: 45, borderScale: 55,
      },
    });
    const contextBuilder = new ProjectContextBuilder();
    const [blockContext, pageContext] = await Promise.all([
      contextBuilder.build({ projectId: project.id, actorUserId: owner.id, target: { type: "building_block", id: navbar.id }, selectedMediaIds: [mediaId], operation: "block_generate" }),
      contextBuilder.build({ projectId: project.id, actorUserId: owner.id, target: { type: "page", id: home.id }, operation: "page_generate" }),
    ]);
    expect(blockContext.theme).toMatchObject({ light: { primary: "#123456", text: "#234567", surface: "#345678" }, dark: { primary: "#ABCDEF" }, radius: 20, spacing: 30, revision: firstTheme.revision });
    expect(pageContext.theme).toMatchObject(blockContext.theme);
    expect(blockContext.theme.resolved.colors.light.primary).toBe("#123456");

    const fragment: Fragment = { html: `<nav class="c-navbar" data-canvas-id="navbar-root"><div class="c-container c-cluster"><a href="/" class="c-nav-brand"><img data-canvas-media="${mediaId}" alt="Logo" class="c-logo"></a><div class="c-nav-links"><a href="/" class="c-link">Home</a><a href="/about" class="c-link">About</a><a href="/contact" class="c-button-secondary">Contact Us</a></div></div></nav>` };
    await runBlockJob(owner.id, project.id, navbar.id, fragment, [mediaId]);
    await runPageJob(owner.id, project.id, home.id, { html: `<main class="c-page" data-canvas-id="page"><div data-canvas-block="${navbar.id}" data-canvas-usage="site-navbar"></div><section class="c-section c-surface" data-canvas-id="intro"><h1>Home</h1></section></main>` }, [{ blockId: navbar.id, usageKey: "site-navbar" }]);
    const [storedBlock] = await db.select().from(buildingBlocks).where(eq(buildingBlocks.id, navbar.id));
    const [storedPage] = await db.select().from(pageNodes).where(eq(pageNodes.id, home.id));
    const blockVersionId = storedBlock!.currentVersionId;
    const pageVersionId = storedPage!.currentVersionId;
    const composedBlock = await new BuildingBlockContentProvider().getActive(project.id, navbar.id, previewMedia);
    const composedPage = await new GeneratedPageContentProvider().get(project.id, home.id, pageVersionId!, previewMedia);

    const firstSession = await new PreviewManifestService().createSession(owner.id, project.id);
    const firstCss = generatedThemeCss(firstSession.manifest.theme);
    const firstBlockDocument = renderBlockPreviewDocument({ manifest: firstSession.manifest, nonce: "nonce", parentOrigin: "http://localhost:3000", instanceId: randomUUID(), initialMode: "light", block: { id: navbar.id, name: "Global navbar", contentStatus: "generated" }, generated: composedBlock!.composed });
    const firstPageDocument = renderPreviewDocument({ manifest: firstSession.manifest, nonce: "nonce", parentOrigin: "http://localhost:3000", instanceId: randomUUID(), initialRoute: "/", initialMode: "dark", generated: composedPage!.composed });
    expect(firstBlockDocument).toContain(firstCss);
    expect(firstPageDocument).toContain(firstCss);
    expect(firstBlockDocument).toContain("data-theme=light");
    expect(firstPageDocument).toContain("data-theme=dark");
    expect(firstCss).toContain(":root[data-theme=light]{--color-primary:#123456");
    expect(firstCss).toContain(":root[data-theme=dark]{--color-primary:#ABCDEF");
    await expectPreviewScriptsToRender(firstBlockDocument, "Contact Us");
    await expectPreviewScriptsToRender(firstPageDocument, "Contact Us");

    await themes.update(owner.id, {
      projectId: project.id,
      expectedRevision: firstTheme.revision,
      theme: {
        ...DEFAULT_THEME,
        lightTokens: { ...DEFAULT_THEME.lightTokens, primary: "#654321", text: "#765432", surface: "#876543" },
        darkTokens: { ...DEFAULT_THEME.darkTokens, primary: "#FEDCBA", text: "#EDCBA9", surface: "#1C2B3A" },
        radiusScale: 90, spacingScale: 85, shadowScale: 80, fontScale: 75, borderScale: 70,
      },
    });
    const refreshed = await new PreviewManifestService().createSession(owner.id, project.id);
    const refreshedCss = generatedThemeCss(refreshed.manifest.theme);
    expect(refreshedCss).toContain(":root[data-theme=light]{--color-primary:#654321");
    expect(refreshedCss).toContain(":root[data-theme=dark]{--color-primary:#FEDCBA");
    expect(refreshedCss).not.toContain("#123456");
    const refreshedBlockDocument = renderBlockPreviewDocument({ manifest: refreshed.manifest, nonce: "nonce", parentOrigin: "http://localhost:3000", instanceId: randomUUID(), initialMode: "light", block: { id: navbar.id, name: "Global navbar", contentStatus: "generated" }, generated: composedBlock!.composed });
    const refreshedPageDocument = renderPreviewDocument({ manifest: refreshed.manifest, nonce: "nonce", parentOrigin: "http://localhost:3000", instanceId: randomUUID(), initialRoute: "/", initialMode: "light", generated: composedPage!.composed });
    expect(refreshedBlockDocument).toContain(refreshedCss);
    expect(refreshedPageDocument).toContain(refreshedCss);
    expect((await db.select().from(buildingBlockVersions).where(eq(buildingBlockVersions.buildingBlockId, navbar.id))).map((version) => version.id)).toEqual([blockVersionId]);
    expect((await db.select().from(pageVersions).where(eq(pageVersions.pageId, home.id))).map((version) => version.id)).toEqual([pageVersionId]);
    await expectPreviewScriptsToRender(refreshedBlockDocument, "Contact Us");
    await expectPreviewScriptsToRender(refreshedPageDocument, "Contact Us");
  });

  it("composes Preview through the same authority that validates a generated version", async () => {
    const { owner, project, mediaId } = await setup();
    const fragment = withMedia(GEMINI_NAVBAR, mediaId);
    // Whatever the generation validator accepts, the Preview must also be able to show.
    const { manifest } = validateGeneratedBlockDocument({
      document: { schemaVersion: 1, html: fragment.html, css: fragment.css ?? "", js: fragment.js ?? "", metadata: null },
      approvedMediaIds: new Set([mediaId]), activeRoutes: new Set(["/"]), declaredMediaIds: [mediaId],
    });
    expect(manifest.editableElements.map((element) => element.canvasId)).toEqual(["navbar-root", "navbar-logo", "navbar-links", "navbar-cta"]);

    const navbar = await new BuildingBlockService().create(owner.id, { projectId: project.id, name: "Global navbar", kind: "navbar", isGlobal: true });
    await runBlockJob(owner.id, project.id, navbar.id, fragment, [mediaId]);
    const composed = await new BuildingBlockContentProvider().getActive(project.id, navbar.id, previewMedia);
    expect(composed?.composed.html).toContain("navbar-root");
  });

  it("explains Gemini-style links to nonexistent pages while preserving the valid logo reference", async () => {
    const { owner, project, mediaId } = await setup();
    const navbar = await new BuildingBlockService().create(owner.id, { projectId: project.id, name: "Global navbar", kind: "navbar", isGlobal: true });
    const fragment: Fragment = { html: `<nav data-canvas-id="navbar-root" class="c-container"><a href="/" data-canvas-id="navbar-logo"><img data-canvas-media="${mediaId}" alt="Logo" class="c-media"></a><div data-canvas-id="navbar-links" class="c-actions"><a href="/">Home</a><a href="/about">About</a><a href="/contact">Contact Us</a></div></nav>` };

    const job = await processBlockJob(owner.id, project.id, navbar.id, fragment, [mediaId]);
    expect(job).toMatchObject({
      status: "failed",
      errorCode: "AI_GENERATED_DOCUMENT_INVALID",
      errorMessage: "/about and /contact do not exist in this project yet. Create those pages first or ask Canvas to use your existing pages.",
      errorDiagnostic: "invalid internal routes: /about, /contact",
      provider: "fixture",
      providerModel: "fixture-1",
      providerRequestId: "fixture-response-id",
      usageMetadata: { inputTokens: 120, outputTokens: 340, totalTokens: 460 },
    });
    expect(job?.resultBlockVersionId).toBeNull();
    const [stored] = await db.select().from(buildingBlocks).where(eq(buildingBlocks.id, navbar.id));
    expect(stored?.currentVersionId).toBeNull();
    expect(await db.select().from(buildingBlockVersions).where(eq(buildingBlockVersions.buildingBlockId, navbar.id))).toHaveLength(0);
  });

  it("reports a normalized, recorded reason when Preview is not configured", async () => {
    const { owner, project } = await setup();
    delete process.env.PREVIEW_TOKEN_SECRET;
    const lines: string[] = [];
    setTelemetrySink((line) => lines.push(line));

    // The service refuses to construct without configuration, so callers must guard.
    const failure = await (async () => new PreviewManifestService().createSession(owner.id, project.id))().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PreviewError);
    expect(failure).toMatchObject({ previewCode: "PREVIEW_NOT_CONFIGURED", code: "VALIDATION" });
    // The user-facing message is plain; the operator detail names the setting.
    expect((failure as PreviewError).message).toMatch(/Preview is not set up for this environment/);
    expect((failure as PreviewError).message).not.toContain("PREVIEW_TOKEN_SECRET");
    expect((failure as PreviewError).detail).toContain("PREVIEW_TOKEN_SECRET");

    const { apiErrorResponse } = await import("@/server/http/errors");
    const response = apiErrorResponse(failure, "Preview could not be prepared.");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "PREVIEW_NOT_CONFIGURED" });

    process.env.PREVIEW_TOKEN_SECRET = "too-short";
    expect(() => new PreviewTokenService()).toThrow(PreviewError);
    void lines;
  });

  it("surfaces unreadable stored content instead of an empty preview", async () => {
    const { owner, project } = await setup();
    const navbar = await new BuildingBlockService().create(owner.id, { projectId: project.id, name: "Broken", kind: "navbar", isGlobal: true });
    await runBlockJob(owner.id, project.id, navbar.id, { html: `<nav data-canvas-id="root"><span>ok</span></nav>` }, []);
    // A stored document that stopped being readable after activation (state corruption).
    const [version] = await db.insert(buildingBlockVersions).values({ projectId: project.id, buildingBlockId: navbar.id, versionNumber: 2, document: { schemaVersion: 2 }, manifest: {}, sourceHash: "a".repeat(64), createdByUserId: owner.id }).returning();
    await db.update(buildingBlocks).set({ currentVersionId: version!.id }).where(eq(buildingBlocks.id, navbar.id));

    const lines: string[] = [];
    setTelemetrySink((line) => lines.push(line));
    const failure = await new BuildingBlockContentProvider().getActive(project.id, navbar.id, previewMedia).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PreviewError);
    expect(failure).toMatchObject({ previewCode: "PREVIEW_DOCUMENT_UNREADABLE" });
    expect((failure as PreviewError).message).toMatch(/could not display this content/i);
    // The failure is recorded operationally with a diagnostic.
    expect(lines.join("\n")).toContain("preview.document_failed");
    expect(lines.join("\n")).not.toContain(PREVIEW_SECRET);
  });

  // A Version written before generated websites became static documents is history, not
  // content: it is refused with an explanation rather than rendered as an empty page.
  it("explains a Version that predates the static document format", async () => {
    const { owner, project } = await setup();
    const navbar = await new BuildingBlockService().create(owner.id, { projectId: project.id, name: "Legacy", kind: "navbar", isGlobal: true });
    const [legacy] = await db.insert(buildingBlockVersions).values({
      projectId: project.id, buildingBlockId: navbar.id, versionNumber: 1,
      sourceCode: `export default function B(){return <nav data-canvas-id="root"/>}`, sourceFormat: "react_tsx",
      manifest: {}, sourceHash: "b".repeat(64), createdByUserId: owner.id,
    }).returning();
    await db.update(buildingBlocks).set({ currentVersionId: legacy!.id }).where(eq(buildingBlocks.id, navbar.id));

    const failure = await new BuildingBlockContentProvider().getActive(project.id, navbar.id, previewMedia).catch((error: unknown) => error);
    expect(failure).toMatchObject({ previewCode: "PREVIEW_LEGACY_DOCUMENT" });
    expect((failure as PreviewError).message).toMatch(/earlier version of Canvas/i);
  });

  it("reports the real runtime reason from inside the sandbox", async () => {
    const { owner, project } = await setup();
    const session = await new PreviewManifestService().createSession(owner.id, project.id);
    for (const document of [
      renderPreviewDocument({ manifest: session.manifest, nonce: "nonce", parentOrigin: "http://localhost:3000", instanceId: randomUUID(), initialRoute: "/", initialMode: "light", generated: { html: `<main data-canvas-id="p"><h1>Home</h1></main>`, css: "", js: "" } }),
      renderBlockPreviewDocument({ manifest: session.manifest, nonce: "nonce", parentOrigin: "http://localhost:3000", instanceId: randomUUID(), initialMode: "light", block: { id: randomUUID(), name: "Block", contentStatus: "generated" }, generated: { html: `<nav data-canvas-id="b"><span>Block</span></nav>`, css: "", js: "" } }),
    ]) {
      // The frame reports what actually failed, and also catches promise rejections.
      expect(document).toContain("reportPreviewFailure");
      expect(document).toContain("unhandledrejection");
      expect(document).not.toContain('message:"Preview could not be loaded."');
      // URLs (which can carry preview tokens) are stripped from any reported detail.
      expect(document).toContain("[url]");
    }
  });

  it("renders a plain-language document when the Preview route itself fails", () => {
    const document = renderPreviewErrorDocument({ nonce: "nonce", message: "Preview is not set up for this environment yet." });
    expect(document).toContain("Preview unavailable");
    expect(document).toContain("Preview is not set up for this environment yet.");
    expect(document).toContain('role="alert"');
    expect(document).toContain('nonce="nonce"');
    expect(document).not.toContain("<script");

    const sessionId = "preview-session-id";
    const instanceId = randomUUID();
    const reported = renderPreviewErrorDocument({
      nonce: "nonce",
      message: "Canvas could not display this content.",
      diagnostic: { code: "PREVIEW_DOCUMENT_UNREADABLE", sessionId, instanceId, parentOrigin: "http://localhost:3000", route: "/", pageId: null },
    });
    expect(reported).toContain("PREVIEW_DOCUMENT_UNREADABLE");
    expect(reported).toContain("parent.postMessage");
    expect(reported).toContain(sessionId);
    expect(reported).toContain(instanceId);
  });
});
