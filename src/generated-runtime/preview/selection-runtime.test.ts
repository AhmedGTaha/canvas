import { describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { projectPreviewManifestSchema, type ProjectPreviewManifest } from "../manifest/schema";
import { renderBlockPreviewDocument, renderPreviewDocument } from "./render-document";

const projectId = "00000000-0000-4000-8000-000000000001";
const homeId = "00000000-0000-4000-8000-000000000002";
const instanceId = "00000000-0000-4000-8000-000000000004";
const blockId = "00000000-0000-4000-8000-000000000005";
const parentOrigin = "http://localhost:3000";
const colors = { primary: "#111111", secondary: "#222222", accent: "#333333", background: "#FFFFFF", surface: "#FAFAFA", text: "#111111", mutedText: "#666666", border: "#DDDDDD" };
const manifest: ProjectPreviewManifest = projectPreviewManifestSchema.parse({
  manifestVersion: 1, projectId, previewSessionId: "session", generatedAt: new Date().toISOString(), previewRevision: "revision", homepage: homeId,
  routes: { "/": { pageId: homeId, name: "Home" } },
  pages: [{ pageId: homeId, parentId: null, name: "Home", canonicalRoute: "/", isHomepage: true, currentVersionId: "00000000-0000-4000-8000-000000000009", contentStatus: "generated", seo: { title: null, description: null } }],
  brand: { companyName: "Acme", companyDescription: null, primaryLogoMediaId: null, alternateLogoMediaId: null, logoMediaIds: { light: null, dark: null } },
  theme: { colors: { light: colors, dark: colors }, radius: { sm: "2px", md: "4px", lg: "8px", xl: "12px" }, spacing: { multiplier: 1, xs: "4px", sm: "8px", md: "16px", lg: "24px", xl: "40px" }, shadows: { sm: "none", md: "none", lg: "none" }, typography: { multiplier: 1, body: "16px", heading: "36px" }, borders: { width: "1px", strongWidth: "2px" } },
  media: {}, blocks: { [blockId]: { id: blockId, name: "Global Navbar", kind: "navbar", isGlobal: true, activeVersionId: "00000000-0000-4000-8000-00000000000a", contentStatus: "generated" } }, navigation: [],
});

/** The composed markup the Preview response now carries inside #generated-root. */
const generatedMarkup = `
  <main class="c-page">
    <section data-canvas-id="hero-main" data-canvas-label="Hero"><h1 data-canvas-id="hero-title">Welcome</h1></section>
    <div class="canvas-block-host" data-canvas-block="${blockId}" data-canvas-usage="site-navbar"><nav data-canvas-id="navbar-root"><a href="/contact">Contact</a></nav></div>
    <article data-canvas-id="pricing-card-pro">Pro</article>
  </main>`;

type Posted = { type: string; [key: string]: unknown };

/**
 * Runs the real Preview document script inside its own isolated DOM, then mounts the
 * generated markup the compiled bundle would have produced. Each boot is a fresh
 * document so no listener or selection state leaks between cases.
 */
function bootPreview(document_: string, markup: string, instance = instanceId) {
  const posted: Posted[] = [];
  const dom = new JSDOM(`<!doctype html><html><body><div id="preview-root" aria-live="polite"><div id="generated-root" class="generated-page-root">${markup}</div></div></body></html>`, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://preview.invalid/" });
  const view = dom.window as unknown as Window & typeof globalThis;
  Object.defineProperty(view, "parent", { configurable: true, value: { postMessage: (message: Posted) => { posted.push(message); } } });
  const script = /<script nonce="nonce">([\s\S]*?)<\/script>/.exec(document_)?.[1];
  if (!script) throw new Error("preview script not found");
  view.eval(script);
  if (!view.document.getElementById("generated-root")) throw new Error("generated root not rendered");
  return {
    posted, dom, view, document: view.document,
    node: (canvasId: string) => view.document.querySelector(`[data-canvas-id="${canvasId}"]`)!,
    fromParent: (message: Record<string, unknown>, origin = parentOrigin, session = "session", target = instance) =>
      view.dispatchEvent(new view.MessageEvent("message", { origin, data: { ...message, sessionId: session, instanceId: target } })),
    click: (canvasId: string) => { const event = new view.MouseEvent("click", { bubbles: true, cancelable: true }); view.document.querySelector(`[data-canvas-id="${canvasId}"]`)!.dispatchEvent(event); return event; },
    hover: (canvasId: string) => view.document.querySelector(`[data-canvas-id="${canvasId}"]`)!.dispatchEvent(new view.MouseEvent("mouseover", { bubbles: true })),
    escape: () => view.document.dispatchEvent(new view.KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    last: (type: string) => [...posted].reverse().find((message) => message.type === type),
  };
}

function pageDocument() {
  return renderPreviewDocument({ manifest, nonce: "nonce", parentOrigin, instanceId, initialRoute: "/", initialMode: "light", generated: { html: generatedMarkup, css: "", js: "" } });
}

describe("preview element selection runtime", () => {
  it("only selects while select mode is enabled, and reports controlled metadata", () => {
    const preview = bootPreview(pageDocument(), generatedMarkup);
    preview.click("pricing-card-pro");
    expect(preview.last("CANVAS_ELEMENT_SELECTED")).toBeUndefined();

    preview.fromParent({ type: "CANVAS_SET_SELECT_MODE", enabled: true });
    expect(preview.document.documentElement.dataset.selectMode).toBe("on");
    preview.click("pricing-card-pro");
    expect(preview.last("CANVAS_ELEMENT_SELECTED")).toEqual({
      type: "CANVAS_ELEMENT_SELECTED", sessionId: "session", instanceId,
      canvasId: "pricing-card-pro", elementType: "article", label: null, blockId: null, usageKey: null, pageId: homeId,
    });
    expect(preview.node("pricing-card-pro").hasAttribute("data-canvas-selected")).toBe(true);
  });

  it("selects the nearest selectable ancestor and marks hover only in select mode", () => {
    const preview = bootPreview(pageDocument(), generatedMarkup);
    preview.hover("hero-title");
    expect(preview.document.querySelectorAll("[data-canvas-hover]")).toHaveLength(0);

    preview.fromParent({ type: "CANVAS_SET_SELECT_MODE", enabled: true });
    preview.hover("hero-title");
    expect(preview.node("hero-title").hasAttribute("data-canvas-hover")).toBe(true);
    // The nearest selectable ancestor wins: clicking the inner heading selects it, not the section.
    preview.click("hero-title");
    expect(preview.last("CANVAS_ELEMENT_SELECTED")).toMatchObject({ canvasId: "hero-title", elementType: "h1" });
  });

  it("reports the owning Building Block and usage key for block-owned elements", () => {
    const preview = bootPreview(pageDocument(), generatedMarkup);
    preview.fromParent({ type: "CANVAS_SET_SELECT_MODE", enabled: true });
    preview.click("navbar-root");
    expect(preview.last("CANVAS_ELEMENT_SELECTED")).toMatchObject({ canvasId: "navbar-root", blockId, usageKey: "site-navbar" });
  });

  it("prevents navigation while selecting and restores normal links afterwards", () => {
    const preview = bootPreview(pageDocument(), generatedMarkup);
    preview.fromParent({ type: "CANVAS_SET_SELECT_MODE", enabled: true });
    const link = preview.document.querySelector("a[href]")!;
    const selecting = new preview.view.MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(selecting);
    expect(selecting.defaultPrevented).toBe(true);
    expect(preview.last("CANVAS_ELEMENT_SELECTED")).toMatchObject({ canvasId: "navbar-root" });

    preview.fromParent({ type: "CANVAS_SET_SELECT_MODE", enabled: false });
    const interacting = new preview.view.MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(interacting);
    expect(interacting.defaultPrevented).toBe(false);
  });

  it("supports switching selection, clearing from Canvas, and clearing with Escape", () => {
    const preview = bootPreview(pageDocument(), generatedMarkup);
    preview.fromParent({ type: "CANVAS_SET_SELECT_MODE", enabled: true });
    preview.click("hero-main");
    preview.click("pricing-card-pro");
    expect(preview.document.querySelectorAll("[data-canvas-selected]")).toHaveLength(1);
    expect(preview.node("pricing-card-pro").hasAttribute("data-canvas-selected")).toBe(true);

    preview.escape();
    expect(preview.document.querySelectorAll("[data-canvas-selected]")).toHaveLength(0);
    expect(preview.last("CANVAS_ELEMENT_CLEARED")).toBeDefined();

    preview.click("hero-main");
    preview.fromParent({ type: "CANVAS_CLEAR_SELECTION" });
    expect(preview.document.querySelectorAll("[data-canvas-selected]")).toHaveLength(0);
  });

  it("restores a selection that still exists and reports it cleared when it does not", async () => {
    const preview = bootPreview(pageDocument(), generatedMarkup);
    preview.fromParent({ type: "CANVAS_SELECT_ELEMENT", canvasId: "hero-main", blockId: null });
    expect(preview.last("CANVAS_ELEMENT_SELECTED")).toMatchObject({ canvasId: "hero-main" });

    preview.fromParent({ type: "CANVAS_SELECT_ELEMENT", canvasId: "removed-region", blockId: null });
    await vi.waitFor(() => expect(preview.last("CANVAS_ELEMENT_CLEARED")).toBeDefined(), { timeout: 3_000 });
  });

  it("does not restore a block-owned ID against a page-owned element", async () => {
    const preview = bootPreview(pageDocument(), generatedMarkup);
    preview.fromParent({ type: "CANVAS_SELECT_ELEMENT", canvasId: "hero-main", blockId });
    await vi.waitFor(() => expect(preview.last("CANVAS_ELEMENT_CLEARED")).toBeDefined(), { timeout: 3_000 });
    expect(preview.last("CANVAS_ELEMENT_SELECTED")).toBeUndefined();
  });

  it("selects identically regardless of the Canvas device width", () => {
    for (const width of [1440, 834, 390]) {
      const preview = bootPreview(pageDocument(), generatedMarkup);
      Object.defineProperty(preview.view, "innerWidth", { configurable: true, value: width });
      preview.fromParent({ type: "CANVAS_SET_SELECT_MODE", enabled: true });
      preview.click("pricing-card-pro");
      expect(preview.last("CANVAS_ELEMENT_SELECTED")).toMatchObject({ canvasId: "pricing-card-pro", elementType: "article" });
    }
  });

  it("selects inside the Building Block preview document with the block as owner", () => {
    const blockMarkup = `<nav data-canvas-id="navbar-root"><a href="/contact" data-canvas-id="navbar-contact-link">Contact</a></nav>`;
    const document_ = renderBlockPreviewDocument({ manifest, nonce: "nonce", parentOrigin, instanceId, initialMode: "light", block: { id: blockId, name: "Global Navbar", contentStatus: "generated" }, generated: { html: blockMarkup, css: "", js: "" } });
    const preview = bootPreview(document_, blockMarkup);
    preview.fromParent({ type: "CANVAS_SET_SELECT_MODE", enabled: true });
    preview.click("navbar-contact-link");
    expect(preview.last("CANVAS_ELEMENT_SELECTED")).toMatchObject({ canvasId: "navbar-contact-link", blockId, usageKey: null, pageId: null });
  });

  it("ignores selection commands from another origin, session, or preview instance", () => {
    const preview = bootPreview(pageDocument(), generatedMarkup);
    preview.fromParent({ type: "CANVAS_SET_SELECT_MODE", enabled: true }, "https://evil.example");
    preview.fromParent({ type: "CANVAS_SET_SELECT_MODE", enabled: true }, parentOrigin, "other-session");
    preview.fromParent({ type: "CANVAS_SET_SELECT_MODE", enabled: true }, parentOrigin, "session", "00000000-0000-4000-8000-0000000000ff");
    expect(preview.document.documentElement.dataset.selectMode).not.toBe("on");
    preview.click("hero-main");
    expect(preview.last("CANVAS_ELEMENT_SELECTED")).toBeUndefined();
  });
});
