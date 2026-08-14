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
import type { AIProvider, AIRequest, AIResponse, StructuredValidator } from "@/domain/ai/provider";
import { getObjectStorage } from "@/server/storage";
import { PreviewManifestService } from "@/generated-runtime/manifest/service";
import { PreviewTokenService } from "@/generated-runtime/security/preview-token";
import { BuildingBlockContentProvider } from "@/domain/blocks/preview";
import { GeneratedPageContentProvider } from "@/generated-runtime/preview/generated-page-provider";
import { renderBlockPreviewDocument, renderPreviewDocument, renderPreviewErrorDocument } from "@/generated-runtime/preview/render-document";
import { validateGeneratedBlockSource } from "@/domain/blocks/validation";
import { PreviewError } from "@/generated-runtime/preview/errors";
import { setTelemetrySink } from "@/server/observability/telemetry";
import { ThemeService } from "@/domain/theme/services";
import { DEFAULT_THEME } from "@/domain/theme/defaults";
import { ProjectContextBuilder } from "@/domain/ai/context";
import { generatedThemeCss } from "./runtime-css";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const PREVIEW_SECRET = "preview-failure-suite-secret-value-long-enough";
const MEDIA_PLACEHOLDER = "__MEDIA_ID__";

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
 * Verbatim shape of a real Gemini-generated Building Block: namespace React import,
 * single-quoted imports, multi-line JSX attributes, `//` comments between attributes and
 * after an attribute value, self-closing CanvasImage with numeric props, and
 * data-canvas-* metadata.
 */
const GEMINI_NAVBAR = `import * as React from 'react';
import { CanvasImage } from '@canvas/site-runtime';

export default function GlobalNavbar() {
  return (
    <nav
      className="c-section"
      data-canvas-id="navbar-root"
      data-canvas-label="Navbar"
    >
      <div className="c-container">
        <div
          className="c-stack"
          // The 'c-stack' class typically creates a vertical stack.
          // Explicit horizontal layout cannot be applied without inline styles.
        >
          <a href="#" data-canvas-id="navbar-logo" data-canvas-label="Logo">
            <CanvasImage
              mediaId="${MEDIA_PLACEHOLDER}"
              alt="Company logo"
              width={40}
              height={40}
            />
          </a>

          <ul
            className="c-stack" // This will stack the navigation links vertically.
            data-canvas-id="navbar-links"
            data-canvas-label="Navigation Links"
          >
            <li><a href="#" className="c-button c-button-secondary">Home</a></li>
            <li><a href="#" className="c-button c-button-secondary">About</a></li>
          </ul>

          <div data-canvas-id="navbar-cta" data-canvas-label="Call to Action">
            <a href="#" className="c-button">Get Started</a>
          </div>
        </div>
      </div>
    </nav>
  );
}`;

class FixtureProvider implements AIProvider {
  name = "fixture"; model = "fixture-1";
  constructor(private readonly source: string, private readonly options: { referencedMediaIds?: string[]; blockUsages?: Array<{ blockId: string; usageKey: string }> } = {}) {}
  async generateText(): Promise<AIResponse> { return { text: "", provider: this.name, model: this.model }; }
  async generateStructured<T>(_request: AIRequest, validator: StructuredValidator<T>): Promise<AIResponse<T>> {
    const value = {
      schemaVersion: 1, sourceCode: this.source, referencedMediaIds: this.options.referencedMediaIds ?? [],
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
async function runBlockJob(userId: string, projectId: string, blockId: string, source: string, mediaIds: string[]) {
  const job = await processBlockJob(userId, projectId, blockId, source, mediaIds);
  expect(job).toMatchObject({ status: "completed" });
}
async function processBlockJob(userId: string, projectId: string, blockId: string, source: string, mediaIds: string[]) {
  const request = await new GenerationJobService().createBlockJob(userId, { projectId, blockId, content: "Create a navbar", selectedMediaIds: mediaIds });
  await claimGenerationJob("worker");
  return new AIOrchestrationService(db, undefined, undefined, () => new FixtureProvider(source, { referencedMediaIds: mediaIds })).process(request.job.id);
}
async function runPageJob(userId: string, projectId: string, pageId: string, source: string, blockUsages: Array<{ blockId: string; usageKey: string }>) {
  const request = await new GenerationJobService().createPageJob(userId, { projectId, pageId, content: "Use the navbar", selectedMediaIds: [] });
  await claimGenerationJob("worker");
  const job = await new AIOrchestrationService(db, undefined, undefined, () => new FixtureProvider(source, { blockUsages })).process(request.job.id);
  expect(job).toMatchObject({ status: "completed" });
}
const environment = { ...process.env };

describe.sequential("Preview failure handling", () => {
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
    const source = GEMINI_NAVBAR.replace(MEDIA_PLACEHOLDER, mediaId);
    const navbar = await new BuildingBlockService().create(owner.id, { projectId: project.id, name: "Global navbar", kind: "navbar", isGlobal: true });
    await runBlockJob(owner.id, project.id, navbar.id, source, [mediaId]);

    // The version that activation produced is the version Preview compiles.
    const [version] = await db.select().from(buildingBlockVersions).where(eq(buildingBlockVersions.buildingBlockId, navbar.id));
    expect(version?.sourceCode).toBe(source);
    const compiled = await new BuildingBlockContentProvider().getActive(project.id, navbar.id);
    expect(compiled?.bundle).toContain("navbar-root");
    expect(compiled?.version.id).toBe(version!.id);

    const session = await new PreviewManifestService().createSession(owner.id, project.id);
    const document = renderBlockPreviewDocument({ manifest: session.manifest, nonce: "nonce", parentOrigin: "http://localhost:3000", instanceId: randomUUID(), initialMode: "light", block: { id: navbar.id, name: "Global navbar", contentStatus: "generated" }, blockBundle: compiled!.bundle });
    expect(document).toContain("generated-root");
    expect(document).toContain("Get Started");
    expectPreviewScriptsToParse(document);
    await expectPreviewScriptsToRender(document, "Get Started");
    // The referenced Media resolves through the manifest, not a storage key.
    expect(session.manifest.media[mediaId]?.previewUrl).toMatch(/^\/api\/preview\/media\//);
    expect(document).not.toContain(version!.sourceCode);
  });

  it("renders the same block inside a Page Preview that uses it globally", async () => {
    const { owner, project, home, mediaId } = await setup();
    const navbar = await new BuildingBlockService().create(owner.id, { projectId: project.id, name: "Global navbar", kind: "navbar", isGlobal: true });
    await runBlockJob(owner.id, project.id, navbar.id, GEMINI_NAVBAR.replace(MEDIA_PLACEHOLDER, mediaId), [mediaId]);
    await runPageJob(owner.id, project.id, home.id, `import { CanvasBlock } from "@canvas/site-runtime";\nexport default function Page(){return <main className="c-page"><CanvasBlock blockId="${navbar.id}" usageKey="site-navbar" /><h1>Home</h1></main>}`, [{ blockId: navbar.id, usageKey: "site-navbar" }]);

    const [node] = await db.select().from(pageNodes).where(eq(pageNodes.id, home.id));
    const generated = await new GeneratedPageContentProvider().get(project.id, home.id, node!.currentVersionId!);
    expect(generated?.bundle).toContain("Get Started");
    expect(generated?.bundle).toContain("navbar-root");

    const session = await new PreviewManifestService().createSession(owner.id, project.id);
    const document = renderPreviewDocument({ manifest: session.manifest, nonce: "nonce", parentOrigin: "http://localhost:3000", instanceId: randomUUID(), initialRoute: "/", initialMode: "light", generatedBundle: generated!.bundle });
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

    const source = `import { CanvasImage } from "@canvas/site-runtime";
export default function GlobalNavbar(){return <nav className="c-navbar" data-canvas-id="navbar-root"><div className="c-container c-cluster"><a href="/" className="c-nav-brand"><CanvasImage mediaId="${mediaId}" alt="Logo" className="c-logo" /></a><div className="c-nav-links"><a href="/" className="c-link">Home</a><a href="/about" className="c-link">About</a><a href="/contact" className="c-button c-button-secondary">Contact Us</a></div></div></nav>}`;
    await runBlockJob(owner.id, project.id, navbar.id, source, [mediaId]);
    await runPageJob(owner.id, project.id, home.id, `import { CanvasBlock } from "@canvas/site-runtime";\nexport default function Page(){return <main className="c-page"><CanvasBlock blockId="${navbar.id}" usageKey="site-navbar" /><section className="c-section c-surface"><h1>Home</h1></section></main>}`, [{ blockId: navbar.id, usageKey: "site-navbar" }]);
    const [storedBlock] = await db.select().from(buildingBlocks).where(eq(buildingBlocks.id, navbar.id));
    const [storedPage] = await db.select().from(pageNodes).where(eq(pageNodes.id, home.id));
    const blockVersionId = storedBlock!.currentVersionId;
    const pageVersionId = storedPage!.currentVersionId;
    const compiledBlock = await new BuildingBlockContentProvider().getActive(project.id, navbar.id);
    const compiledPage = await new GeneratedPageContentProvider().get(project.id, home.id, pageVersionId!);

    const firstSession = await new PreviewManifestService().createSession(owner.id, project.id);
    const firstCss = generatedThemeCss(firstSession.manifest.theme);
    const firstBlockDocument = renderBlockPreviewDocument({ manifest: firstSession.manifest, nonce: "nonce", parentOrigin: "http://localhost:3000", instanceId: randomUUID(), initialMode: "light", block: { id: navbar.id, name: "Global navbar", contentStatus: "generated" }, blockBundle: compiledBlock!.bundle });
    const firstPageDocument = renderPreviewDocument({ manifest: firstSession.manifest, nonce: "nonce", parentOrigin: "http://localhost:3000", instanceId: randomUUID(), initialRoute: "/", initialMode: "dark", generatedBundle: compiledPage!.bundle });
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
    const refreshedBlockDocument = renderBlockPreviewDocument({ manifest: refreshed.manifest, nonce: "nonce", parentOrigin: "http://localhost:3000", instanceId: randomUUID(), initialMode: "light", block: { id: navbar.id, name: "Global navbar", contentStatus: "generated" }, blockBundle: compiledBlock!.bundle });
    const refreshedPageDocument = renderPreviewDocument({ manifest: refreshed.manifest, nonce: "nonce", parentOrigin: "http://localhost:3000", instanceId: randomUUID(), initialRoute: "/", initialMode: "light", generatedBundle: compiledPage!.bundle });
    expect(refreshedBlockDocument).toContain(refreshedCss);
    expect(refreshedPageDocument).toContain(refreshedCss);
    expect((await db.select().from(buildingBlockVersions).where(eq(buildingBlockVersions.buildingBlockId, navbar.id))).map((version) => version.id)).toEqual([blockVersionId]);
    expect((await db.select().from(pageVersions).where(eq(pageVersions.pageId, home.id))).map((version) => version.id)).toEqual([pageVersionId]);
    await expectPreviewScriptsToRender(refreshedBlockDocument, "Contact Us");
    await expectPreviewScriptsToRender(refreshedPageDocument, "Contact Us");
  });

  it("compiles Preview through the same authority that validates a generated version", async () => {
    const { owner, project, mediaId } = await setup();
    const source = GEMINI_NAVBAR.replace(MEDIA_PLACEHOLDER, mediaId);
    // Whatever the generation validator accepts, the Preview compiler must also accept.
    const manifest = await validateGeneratedBlockSource({ sourceCode: source, approvedMediaIds: new Set([mediaId]), activeRoutes: new Set(["/"]), declaredMediaIds: [mediaId] });
    expect(manifest.editableElements.map((element) => element.canvasId)).toEqual(["navbar-root", "navbar-logo", "navbar-links", "navbar-cta"]);

    const navbar = await new BuildingBlockService().create(owner.id, { projectId: project.id, name: "Global navbar", kind: "navbar", isGlobal: true });
    await runBlockJob(owner.id, project.id, navbar.id, source, [mediaId]);
    await expect(new BuildingBlockContentProvider().getActive(project.id, navbar.id)).resolves.toMatchObject({ bundle: expect.stringContaining("navbar-root") });
  });

  it("explains Gemini-style links to nonexistent pages while preserving the valid logo reference", async () => {
    const { owner, project, mediaId } = await setup();
    const navbar = await new BuildingBlockService().create(owner.id, { projectId: project.id, name: "Global navbar", kind: "navbar", isGlobal: true });
    const source = `import * as React from "react";
import { CanvasImage } from "@canvas/site-runtime";
export default function GlobalNavbar(){return <nav data-canvas-id="navbar-root" className="c-container"><a href="/" data-canvas-id="navbar-logo"><CanvasImage mediaId="${mediaId}" alt="Logo" className="c-media" /></a><div data-canvas-id="navbar-links" className="c-actions"><a href="/">Home</a><a href="/about">About</a><a href="/contact">Contact Us</a></div></nav>}`;

    const job = await processBlockJob(owner.id, project.id, navbar.id, source, [mediaId]);
    expect(job).toMatchObject({
      status: "failed",
      errorCode: "AI_GENERATED_SOURCE_INVALID",
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

  it("surfaces a compile failure instead of an empty preview", async () => {
    const { owner, project } = await setup();
    const navbar = await new BuildingBlockService().create(owner.id, { projectId: project.id, name: "Broken", kind: "navbar", isGlobal: true });
    await runBlockJob(owner.id, project.id, navbar.id, `export default function B(){return <nav data-canvas-id="root"><span>ok</span></nav>}`, []);
    // Source that only became uncompilable after activation (a stored-state corruption).
    const [version] = await db.insert(buildingBlockVersions).values({ projectId: project.id, buildingBlockId: navbar.id, versionNumber: 2, sourceCode: `export default function B(){return <nav>}`, manifest: {}, sourceHash: "a".repeat(64), createdByUserId: owner.id }).returning();
    await db.update(buildingBlocks).set({ currentVersionId: version!.id }).where(eq(buildingBlocks.id, navbar.id));

    const lines: string[] = [];
    setTelemetrySink((line) => lines.push(line));
    const failure = await new BuildingBlockContentProvider().getActive(project.id, navbar.id).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PreviewError);
    expect(failure).toMatchObject({ previewCode: "PREVIEW_COMPILE_FAILED" });
    expect((failure as PreviewError).message).toMatch(/could not display this content/i);
    // The failure is recorded operationally with a diagnostic.
    expect(lines.join("\n")).toContain("preview.compile_failed");
    expect(lines.join("\n")).not.toContain(PREVIEW_SECRET);
  });

  it("reports the real runtime reason from inside the sandbox", async () => {
    const { owner, project } = await setup();
    const session = await new PreviewManifestService().createSession(owner.id, project.id);
    for (const document of [
      renderPreviewDocument({ manifest: session.manifest, nonce: "nonce", parentOrigin: "http://localhost:3000", instanceId: randomUUID(), initialRoute: "/", initialMode: "light", generatedBundle: "/* bundle */" }),
      renderBlockPreviewDocument({ manifest: session.manifest, nonce: "nonce", parentOrigin: "http://localhost:3000", instanceId: randomUUID(), initialMode: "light", block: { id: randomUUID(), name: "Block", contentStatus: "generated" }, blockBundle: "/* bundle */" }),
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
      diagnostic: { code: "PREVIEW_COMPILE_FAILED", sessionId, instanceId, parentOrigin: "http://localhost:3000", route: "/", pageId: null },
    });
    expect(reported).toContain("PREVIEW_COMPILE_FAILED");
    expect(reported).toContain("parent.postMessage");
    expect(reported).toContain(sessionId);
    expect(reported).toContain(instanceId);
  });
});
