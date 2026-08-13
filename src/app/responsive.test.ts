import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/app/globals.css", "utf8");
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sources(target);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [target] : [];
  });
}
const appCode = sources("src/components").concat(sources("src/app")).map((file) => readFileSync(file, "utf8")).join("\n");

describe("responsive layout", () => {
  it("declares the tablet and mobile breakpoints the layouts depend on", () => {
    const queries = [...css.matchAll(/@media \(max-width:\s*(\d+)px\)/g)].map((match) => Number(match[1]));
    expect(queries).toContain(900);
    expect(queries).toContain(680);
  });

  it("collapses every multi-column workspace on small screens", () => {
    const tablet = css.slice(css.indexOf("@media (max-width: 900px)"), css.indexOf("@media (max-width: 680px)"));
    const mobile = css.slice(css.indexOf("@media (max-width: 680px)"));
    // Each of these is a fixed multi-column grid at desktop width.
    for (const layout of ["builder-workspace", "blocks-workspace", "media-layout", "theme-editor-layout", "project-layout", "card-grid"]) {
      expect(`${tablet}${mobile}`, `${layout} has no small-screen rule`).toContain(layout);
    }
    // The Builder and Blocks stacks become single-column, not squeezed columns.
    expect(mobile).toMatch(/\.builder-workspace, \.blocks-workspace \{ display: flex; flex-direction: column;/);
    expect(mobile).toContain(".export-intro, .export-row { align-items: stretch; flex-direction: column; }");
  });

  it("lets a tall dialog scroll instead of running off the viewport", () => {
    // <dialog> is sized by its content, so without a cap the bottom of a long
    // form (page settings, history, the media picker) becomes unreachable.
    expect(css).toMatch(/\.dialog \{[^}]*max-height: calc\(100vh - 48px\)/);
    expect(css).toMatch(/\.dialog-panel \{[^}]*max-height: calc\(100vh - 48px\)[^}]*overflow-y: auto/);
  });

  it("keeps dialogs and panels inside the viewport on phones", () => {
    for (const rule of [/\.dialog \{[^}]*width: min\(480px, calc\(100vw - 32px\)\)/, /\.history-panel \{[^}]*width: min\(560px, calc\(100vw - 32px\)\)/, /\.media-picker-dialog \{[^}]*width: min\(720px, calc\(100vw - 32px\)\)/]) {
      expect(css).toMatch(rule);
    }
  });

  it("keeps the sidebar reachable and the preview usable on mobile", () => {
    const mobile = css.slice(css.indexOf("@media (max-width: 680px)"));
    expect(mobile).toMatch(/\.sidebar \{[^}]*height: 62px/);
    expect(mobile).toMatch(/\.app-frame \{[^}]*margin-left: 0/);
    expect(mobile).toContain(".preview-canvas { padding: 10px; }");
  });

  it("respects reduced-motion preferences", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toMatch(/prefers-reduced-motion: reduce\)[^}]*\{[\s\S]{0,200}animation-duration: \.01ms !important/);
  });
});

describe("browser compatibility", () => {
  /** Features that are not supported across the current stable Chrome/Firefox/Safari/Edge set. */
  const RISKY_CSS = [
    { pattern: /@container\b/, name: "CSS container queries with fallback-free layout" },
    { pattern: /:has\(/, name: ":has() selector" },
    { pattern: /color-mix\(/, name: "color-mix()" },
    { pattern: /\btext-wrap:\s*(pretty|balance)/, name: "text-wrap: pretty/balance" },
    { pattern: /field-sizing:/, name: "field-sizing" },
    { pattern: /anchor-name:|position-anchor:/, name: "CSS anchor positioning" },
    { pattern: /@scope\b/, name: "@scope" },
  ];
  const RISKY_JS = [
    { pattern: /\bdocument\.startViewTransition\b/, name: "View Transitions API" },
    { pattern: /\bnavigator\.scheduling\b/, name: "navigator.scheduling" },
    { pattern: /\bObject\.groupBy\b|\bMap\.groupBy\b/, name: "Object.groupBy" },
    { pattern: /\bArray\.prototype\.toSorted\b|\.toSorted\(/, name: "Array.toSorted" },
    { pattern: /\bPromise\.withResolvers\b/, name: "Promise.withResolvers" },
    { pattern: /\bnavigator\.clipboard\.read\b/, name: "clipboard read" },
    { pattern: /\bCSSStyleSheet\b/, name: "constructable stylesheets" },
  ];

  it("avoids CSS features outside the supported browser matrix", () => {
    for (const feature of RISKY_CSS) expect(css, `globals.css uses ${feature.name}`).not.toMatch(feature.pattern);
  });

  it("never branches on the platform while rendering", () => {
    // `navigator` does not exist during SSR, so reading it to build rendered
    // text produces one string on the server and another on the client, which
    // React reports as a hydration mismatch. Shortcut hints name both modifiers.
    for (const pattern of [/navigator\.platform/, /navigator\.userAgent/, /navigator\.maxTouchPoints/]) {
      expect(appCode, `client code branches on ${pattern.source} during render`).not.toMatch(pattern);
    }
  });

  it("avoids JavaScript APIs outside the supported browser matrix", () => {
    for (const feature of RISKY_JS) expect(appCode, `client code uses ${feature.name}`).not.toMatch(feature.pattern);
  });

  it("uses only broadly supported platform APIs in client components", () => {
    // These are the newest APIs Canvas relies on; all ship in current stable
    // Chrome, Firefox, Safari, and Edge.
    expect(appCode).toContain("showModal");
    expect(appCode).toContain("crypto.randomUUID");
    expect(css).toContain(":focus-visible");
    expect(css).toContain("::backdrop");
    // Nothing may depend on a vendor-only prefix for layout or interaction.
    expect(css).not.toMatch(/-moz-|-ms-(?!overflow)/);
  });
});
