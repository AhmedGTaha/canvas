import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * The stylesheet is layered — tokens, base, components, screens, workspace,
 * panels — so these read the layer that owns the rule rather than one giant
 * file. `css` is all of them, for the checks that are about the product as a
 * whole (no unsupported feature anywhere, reduced motion honoured somewhere).
 */
const sheet = (name: string) => readFileSync(`src/app/${name}.css`, "utf8");
const base = sheet("base");
const ui = sheet("ui");
const app = sheet("app");
const workspace = sheet("workspace");
const panels = sheet("panels");
const css = [base, ui, app, workspace, panels].join("\n");

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sources(target);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [target] : [];
  });
}
const appCode = sources("src/components").concat(sources("src/app")).map((file) => readFileSync(file, "utf8")).join("\n");

describe("responsive layout", () => {
  it("declares the breakpoints each layer degrades at", () => {
    const queries = (input: string) => [...input.matchAll(/@media \(max-width:\s*(\d+)px\)/g)].map((match) => Number(match[1]));
    // The workspace is chrome: laptop, then phone.
    expect(queries(workspace)).toContain(1279);
    expect(queries(workspace)).toContain(767);
    // Tool panels lose their side columns earlier, because they open inset.
    expect(queries(panels)).toContain(1100);
    expect(queries(panels)).toContain(767);
    // The screens outside a project are one column of content.
    expect(queries(app)).toContain(720);
  });

  it("collapses every multi-column layout on small screens", () => {
    const small = panels.slice(panels.lastIndexOf("@media (max-width: 767px)"));
    // Each of these is a fixed multi-column grid at desktop width.
    for (const layout of ["media-layout", "blocks-workspace", "tool-split"]) {
      expect(small, `${layout} has no small-screen rule`).toContain(layout);
    }
    // They stack, rather than being squeezed into narrower columns.
    expect(small).toMatch(/\.media-layout, \.blocks-workspace, \.tool-split \{ display: flex; flex-direction: column;/);
    expect(small).toContain(".export-row, .reset-row { align-items: stretch; flex-direction: column; }");
    // And the settings grids drop to one column rather than two 90px ones.
    expect(small).toContain(".color-grid, .logo-picker-grid { grid-template-columns: 1fr; }");
  });

  it("lets a tall dialog scroll instead of running off the viewport", () => {
    // <dialog> is sized by its content, so without a cap the bottom of a long
    // form (page settings, the image picker) becomes unreachable.
    expect(ui).toMatch(/\.dialog \{[^}]*max-height: calc\(100vh - var\(--sp-24\)\)/);
    expect(ui).toMatch(/\.dialog-panel \{[^}]*max-height: calc\(100vh - var\(--sp-24\)\)[^}]*overflow-y: auto/);
  });

  it("keeps dialogs and panels inside the viewport on phones", () => {
    expect(ui).toMatch(/\.dialog \{[^}]*width: min\(520px, calc\(100vw - var\(--sp-16\)\)\)/);
    expect(panels).toMatch(/\.media-picker-dialog \{[^}]*width: min\(720px, calc\(100vw - var\(--sp-16\)\)\)/);
    // On a phone every overlay is the whole screen rather than a floating card
    // with its edges off-screen.
    const phone = workspace.slice(workspace.lastIndexOf("@media (max-width: 767px)"));
    expect(phone).toMatch(/\.ws-panel-wide, \.ws-panel-drawer \{\s*inset: 0/);
    expect(phone).toMatch(/\.command-palette, \.task-center, \.change-review \{[^}]*width: 100vw/);
  });

  it("keeps one workspace surface usable at a time on a phone", () => {
    const phone = workspace.slice(workspace.lastIndexOf("@media (max-width: 767px)"));
    for (const surface of ["tools", "preview", "agent"]) expect(phone).toContain(`data-surface="${surface}"`);
    // The status bar's row collapses to nothing rather than overlapping the
    // surface switcher at the bottom of the screen.
    expect(phone).toMatch(/--ws-statusbar-h: 0px/);
    expect(phone).toMatch(/\.ws-statusbar \{ display: none; \}/);
    expect(phone).toContain(".ws-mobile-switcher {");
  });

  it("never leaves the preview in a column it cannot fill", () => {
    // Panes are hidden with display:none, which takes them out of grid layout
    // entirely; without explicit columns the stage slides into the 0px slot the
    // sidebar just vacated.
    for (const rule of [/\.ws-activity \{ grid-column: 1; \}/, /\.ws-pane-l \{ grid-column: 2; \}/, /\.ws-stage \{ grid-column: 3; \}/, /\.ws-pane-r \{ grid-column: 4; \}/]) {
      expect(workspace).toMatch(rule);
    }
  });

  it("respects reduced-motion preferences", () => {
    expect(base).toContain("@media (prefers-reduced-motion: reduce)");
    expect(base).toMatch(/prefers-reduced-motion: reduce\)[^}]*\{[\s\S]{0,300}animation-duration: 0\.01ms !important/);
    // Surfaces that animate in also opt out individually, so a panel that is
    // already open does not re-run its entrance.
    for (const layer of [ui, workspace]) expect(layer).toContain("@media (prefers-reduced-motion: reduce)");
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
    for (const feature of RISKY_CSS) expect(css, `the stylesheet uses ${feature.name}`).not.toMatch(feature.pattern);
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
    expect(base).toContain(":focus-visible");
    expect(css).toContain("::backdrop");
    // Nothing may depend on a vendor-only prefix for layout or interaction.
    expect(css).not.toMatch(/-moz-|-ms-(?!overflow)/);
  });
});
