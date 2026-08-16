import { describe, expect, it } from "vitest";
import { composeDocument, composeFragment, usageScopeToken, type MediaResolver } from "./composition";
import type { GeneratedDocument } from "./document";

const mediaId = "11111111-1111-4111-8111-111111111111";
const blockId = "22222222-2222-4222-8222-222222222222";
const otherBlockId = "33333333-3333-4333-8333-333333333333";

const media: MediaResolver = (id) => (id === mediaId ? { url: "/api/preview/media/asset", width: 800, height: 600, altText: "Fallback" } : null);

function doc(overrides: Partial<GeneratedDocument> = {}): GeneratedDocument {
  return { schemaVersion: 1, html: "", css: "", js: "", metadata: null, ...overrides };
}

const navbar = doc({
  html: `<nav class="c-navbar" data-canvas-id="navbar"><button type="button" class="menu" aria-controls="menu" aria-expanded="false">Menu</button><div id="menu" class="panel" hidden><a class="c-link" href="#menu">Top</a></div></nav>`,
  css: `.panel{display:grid}.menu{color:var(--color-accent)}@keyframes reveal{from{opacity:0}to{opacity:1}}.panel:not([hidden]){animation:reveal .2s}`,
  js: `var toggle = document.querySelector(".menu"); if (toggle) toggle.addEventListener("click", function () {});`,
});

const page = doc({
  html: `<main class="c-page" data-canvas-id="page"><div data-canvas-block="${blockId}" data-canvas-usage="site-navbar"></div><div data-canvas-block="${blockId}" data-canvas-usage="footer-navbar"></div><img data-canvas-media="${mediaId}" alt=""><a href="/about">About</a></main>`,
  css: `.panel{color:red}`,
  js: `var root = document.querySelector(".c-page");`,
  metadata: { title: "Home", description: null },
});

const blocks = new Map([
  [`${blockId}:site-navbar`, { blockId, usageKey: "site-navbar", document: navbar }],
  [`${blockId}:footer-navbar`, { blockId, usageKey: "footer-navbar", document: navbar }],
]);

describe("page composition", () => {
  const composed = composeDocument({ document: page, blocks, media, mode: "preview" });
  const first = usageScopeToken("site-navbar");
  const second = usageScopeToken("footer-navbar");

  it("places each block inside its own host", () => {
    expect(composed.html).toContain(`class="canvas-block-host ${first}"`);
    expect(composed.html).toContain(`class="canvas-block-host ${second}"`);
    expect(composed.html.match(/c-navbar/g)).toHaveLength(2);
  });

  it("confines a block's styles to that block", () => {
    expect(composed.css).toContain(`.${first} .panel{display:grid}`);
    expect(composed.css).toContain(`.${second} .panel{display:grid}`);
    // The page's own `.panel` rule is left global, so the block cannot restyle the page
    // and the page cannot accidentally be restyled by the block.
    expect(composed.css).toContain(`.panel{color:red}`);
  });

  it("renames animations per usage so two copies of a block cannot collide", () => {
    expect(composed.css).toContain(`@keyframes ${first}-reveal`);
    expect(composed.css).toContain(`@keyframes ${second}-reveal`);
    expect(composed.css).toContain(`animation:${first}-reveal .2s`);
  });

  it("makes ids unique per usage, including everything that references them", () => {
    expect(composed.html).toContain(`id="${first}-menu"`);
    expect(composed.html).toContain(`aria-controls="${first}-menu"`);
    expect(composed.html).toContain(`href="#${first}-menu"`);
    expect(composed.html).toContain(`id="${second}-menu"`);
    expect(composed.html).not.toContain(`id="menu"`);
  });

  it("keeps each script in its own scope with the escape hatches shadowed", () => {
    expect(composed.js.match(/use strict/g)).toHaveLength(3);
    expect(composed.js).toContain("parent,top,opener");
  });

  it("resolves Media to the session URL and never to a storage key", () => {
    expect(composed.html).toContain(`src="/api/preview/media/asset"`);
    expect(composed.html).toContain(`alt="Fallback"`);
    expect(composed.html).toContain(`width="800"`);
    expect(composed.html).not.toContain("data-canvas-media");
    expect(composed.missingMedia).toEqual([]);
  });

  it("keeps editor attributes in the Preview and strips them from an export", () => {
    expect(composed.html).toContain(`data-canvas-id="page"`);
    const exported = composeDocument({ document: page, blocks, media, mode: "export" });
    expect(exported.html).not.toContain("data-canvas-");
    // The scope class survives, because the block's stylesheet depends on it.
    expect(exported.html).toContain(first);
  });

  it("rewrites internal links to files only when an export asks it to", () => {
    expect(composed.html).toContain(`href="/about"`);
    const exported = composeDocument({ document: page, blocks, media, mode: "export", links: (route) => (route === "/about" ? "about.html" : null) });
    expect(exported.html).toContain(`href="about.html"`);
  });

  it("reports a block host that resolves to nothing instead of failing the page", () => {
    const orphan = doc({ html: `<main data-canvas-id="p"><div data-canvas-block="${otherBlockId}" data-canvas-usage="ghost"></div></main>` });
    const result = composeDocument({ document: orphan, media, mode: "preview" });
    expect(result.missingBlocks).toEqual([`${otherBlockId}:ghost`]);
    expect(result.html).toContain("data-canvas-block");
  });

  it("reports Media that is not part of the session", () => {
    const missing = doc({ html: `<main data-canvas-id="p"><img data-canvas-media="${otherBlockId}" alt="x"></main>` });
    expect(composeDocument({ document: missing, media, mode: "preview" }).missingMedia).toEqual([otherBlockId]);
  });
});

describe("fragment composition", () => {
  it("composes a Building Block on its own without scoping it", () => {
    const result = composeFragment({ document: navbar, media, mode: "preview" });
    expect(result.html).toContain(`id="menu"`);
    expect(result.css).toContain(`.panel{display:grid}`);
    expect(result.js).toContain("use strict");
  });
});
