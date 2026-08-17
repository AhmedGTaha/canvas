import { describe, expect, it } from "vitest";
import { builderViewReducer, INITIAL_BUILDER_VIEW } from "./builder-state";
import { parseParentPreviewMessage, parsePreviewParentMessage } from "./messages";
import { initialPreviewRoute, normalizePreviewRoute, resolvePreviewRoute } from "./router";
import { PREVIEW_IFRAME_SANDBOX, previewSecurityHeaders } from "../security/headers";
import { projectPreviewManifestSchema, type ProjectPreviewManifest } from "../manifest/schema";
import { renderPreviewDocument } from "../preview/render-document";

const projectId = "00000000-0000-4000-8000-000000000001"; const homeId = "00000000-0000-4000-8000-000000000002"; const aboutId = "00000000-0000-4000-8000-000000000003"; const instanceId = "00000000-0000-4000-8000-000000000004";
const colors = { primary: "#111111", secondary: "#222222", accent: "#333333", background: "#FFFFFF", surface: "#FAFAFA", text: "#111111", mutedText: "#666666", border: "#DDDDDD" };
const manifest: ProjectPreviewManifest = projectPreviewManifestSchema.parse({ manifestVersion: 1, projectId, previewSessionId: "session", generatedAt: new Date().toISOString(), previewRevision: "revision", homepage: homeId, routes: { "/": { pageId: homeId, name: "Home" }, "/about": { pageId: aboutId, name: "About" } }, pages: [{ pageId: homeId, parentId: null, name: "Home", canonicalRoute: "/", isHomepage: true, seo: { title: null, description: null } }, { pageId: aboutId, parentId: null, name: "About", canonicalRoute: "/about", isHomepage: false, seo: { title: null, description: null } }], brand: { companyName: "Acme", companyDescription: null, primaryLogoMediaId: null, alternateLogoMediaId: null, logoMediaIds: { light: null, dark: null } }, theme: { colors: { light: colors, dark: colors }, radius: { sm: "2px", md: "4px", lg: "8px", xl: "12px" }, spacing: { multiplier: 1, xs: "4px", sm: "8px", md: "16px", lg: "24px", xl: "40px" }, shadows: { sm: "none", md: "none", lg: "none" }, typography: { multiplier: 1, body: "16px", heading: "36px", headingFamily: "Georgia, serif", bodyFamily: "Arial, sans-serif" }, borders: { width: "1px", strongWidth: "2px" } }, media: {}, navigation: [] });

describe("preview runtime contracts", () => {
  it("resolves homepage, selected, normalized, and not-found routes", () => {
    expect(initialPreviewRoute(manifest)).toBe("/"); expect(initialPreviewRoute(manifest, aboutId)).toBe("/about");
    expect(normalizePreviewRoute("/about/")).toBe("/about"); expect(resolvePreviewRoute(manifest, "/about/").page?.pageId).toBe(aboutId); expect(resolvePreviewRoute(manifest, "/missing").page).toBeNull();
  });

  it("accepts only scoped messages from the expected opaque iframe or Canvas parent", () => {
    const ready = { type: "CANVAS_PREVIEW_READY", sessionId: "session", instanceId, route: "/" };
    expect(parsePreviewParentMessage(ready, "null", true, "session", instanceId)).toEqual(ready);
    expect(parsePreviewParentMessage(ready, "https://evil.test", true, "session", instanceId)).toBeNull();
    expect(parsePreviewParentMessage({ ...ready, sessionId: "wrong" }, "null", true, "session", instanceId)).toBeNull();
    expect(parsePreviewParentMessage({ type: "UNKNOWN" }, "null", true, "session", instanceId)).toBeNull();
    const navigate = { type: "CANVAS_NAVIGATE", sessionId: "session", instanceId, route: "/about" };
    expect(parseParentPreviewMessage(navigate, "https://canvas.test", "https://canvas.test", "session", instanceId)).toEqual(navigate);
    expect(parseParentPreviewMessage(navigate, "https://evil.test", "https://canvas.test", "session", instanceId)).toBeNull();
  });

  it("keeps the iframe sandbox restrictive and emits hardened preview headers", () => {
    expect(PREVIEW_IFRAME_SANDBOX).toBe("allow-scripts"); expect(PREVIEW_IFRAME_SANDBOX).not.toMatch(/allow-same-origin|allow-top-navigation|allow-forms|allow-popups/);
    const headers = previewSecurityHeaders("nonce", "https://canvas.test/path");
    expect(headers["Content-Security-Policy"]).toContain("default-src 'none'"); expect(headers["Content-Security-Policy"]).toContain("connect-src 'none'"); expect(headers["Content-Security-Policy"]).toContain("object-src 'none'"); expect(headers["Content-Security-Policy"]).toContain("frame-ancestors https://canvas.test");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff"); expect(headers["Referrer-Policy"]).toBe("no-referrer"); expect(headers["Cross-Origin-Embedder-Policy"]).toBe("credentialless");
  });

  it("tracks device, theme, and app-level full-screen state without losing the other modes", () => {
    const tablet = builderViewReducer(INITIAL_BUILDER_VIEW, { type: "SET_DEVICE", device: "tablet" }); const dark = builderViewReducer(tablet, { type: "SET_THEME", theme: "dark" }); const full = builderViewReducer(dark, { type: "TOGGLE_FULL_SCREEN" });
    expect(full).toEqual({ device: "tablet", theme: "dark", fullScreen: true }); expect(builderViewReducer(full, { type: "EXIT_FULL_SCREEN" })).toEqual({ device: "tablet", theme: "dark", fullScreen: false }); expect(builderViewReducer(full, { type: "SET_DEVICE", device: "mobile" }).theme).toBe("dark");
  });

  it("renders only the controlled nonce-backed runtime document", () => {
    const html = renderPreviewDocument({ manifest, nonce: "test-nonce", parentOrigin: "https://canvas.test", instanceId, initialRoute: "/about", initialMode: "dark" });
    expect(html).toContain('nonce="test-nonce"'); expect(html).toContain('"initialMode":"dark"'); expect(html).toContain("dataset.canvasId");
    expect(html).not.toMatch(/<script[^>]+src=/); expect(html).not.toContain("eval("); expect(html).not.toContain("new Function"); expect(html).not.toContain("process.env");
  });
});
