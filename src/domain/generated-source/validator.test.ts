import { describe, expect, it } from "vitest";
import { validateGeneratedSource } from "./validator";
import { validateGeneratedBlockSource } from "@/domain/blocks/validation";

const mediaId = "11111111-1111-4111-8111-111111111111";
const blockId = "33333333-3333-4333-8333-333333333333";
const otherBlockId = "44444444-4444-4444-8444-444444444444";
const blockSource = `export default function GeneratedBlock(){return <nav className="c-container"><a href="/contact">Contact</a></nav>}`;
const base = { approvedMediaIds: new Set([mediaId]), activeRoutes: new Set(["/", "/contact"]) };
const withBlocks = { ...base, availableBlockIds: new Set([blockId, otherBlockId]), blockSources: new Map([[blockId, blockSource], [otherBlockId, blockSource]]) };

describe("Building Block source validation", () => {
  it("compiles a block that uses project theme classes, Media, and valid routes", async () => {
    const sourceCode = `import { CanvasImage } from "@canvas/site-runtime";
export default function GeneratedBlock(){return <nav className="c-container" aria-label="Main"><CanvasImage mediaId="${mediaId}" alt="Logo" className="c-media" /><a href="/contact">Contact</a></nav>}`;
    await expect(validateGeneratedBlockSource({ sourceCode, ...base, declaredMediaIds: [mediaId] })).resolves.toMatchObject({ referencedMediaIds: [mediaId], internalRoutes: ["/contact"], blockUsages: [] });
  });

  it("accepts a realistic semantic navbar and rejects classes outside the shared runtime contract", async () => {
    const sourceCode = `import { CanvasImage } from "@canvas/site-runtime";
export default function GeneratedNavbar(){return <nav className="c-navbar"><div className="c-container c-cluster"><a href="/" className="c-nav-brand"><CanvasImage mediaId="${mediaId}" alt="Logo" className="c-logo" /></a><div className="c-nav-links"><a href="/" className="c-link">Home</a><a href="/contact" className="c-button">Contact</a></div></div></nav>}`;
    await expect(validateGeneratedBlockSource({ sourceCode, ...base, declaredMediaIds: [mediaId] })).resolves.toMatchObject({ referencedMediaIds: [mediaId], internalRoutes: ["/", "/contact"] });
    await expect(validateGeneratedBlockSource({ sourceCode: `export default function B(){return <nav className="flex text-blue-500"/>}`, ...base, declaredMediaIds: [] }))
      .rejects.toMatchObject({ diagnostic: "unsupported runtime classes: flex, text-blue-500" });
  });

  it("rejects routes that are not part of the project page tree", async () => {
    await expect(validateGeneratedBlockSource({ sourceCode: `export default function B(){return <nav><a href="/careers">Careers</a><a href="/about">About</a></nav>}`, ...base, declaredMediaIds: [] }))
      .rejects.toMatchObject({
        message: "/about and /careers do not exist in this project yet. Create those pages first or ask Canvas to use your existing pages.",
        diagnostic: "invalid internal routes: /about, /careers",
      });
  });

  it("rejects the real Gemini inline-style construct even when it uses theme tokens", async () => {
    const sourceCode = `export default function Navbar(){return <nav data-canvas-id="navbar-root" className="c-container" style={{display:"flex",alignItems:"center",color:"var(--color-text)"}}><div className="c-actions"><a href="/">Home</a></div></nav>}`;
    await expect(validateGeneratedBlockSource({ sourceCode, ...base, declaredMediaIds: [] })).rejects.toMatchObject({
      message: "Canvas generated code that uses an unsupported or unsafe website feature. Try a simpler request.",
      diagnostic: "inline style attributes are not allowed",
    });
  });

  it("rejects foreign, hallucinated, and undeclared Media references", async () => {
    const foreign = "22222222-2222-4222-8222-222222222222";
    await expect(validateGeneratedBlockSource({ sourceCode: `import{CanvasImage}from"@canvas/site-runtime";export default function B(){return <CanvasImage mediaId="${foreign}" alt=""/>}`, ...base, declaredMediaIds: [foreign] }))
      .rejects.toMatchObject({ diagnostic: expect.stringContaining("invalid media ID") });
    await expect(validateGeneratedBlockSource({ sourceCode: `import{CanvasImage}from"@canvas/site-runtime";export default function B(){return <CanvasImage mediaId="${mediaId}" alt=""/>}`, ...base, declaredMediaIds: [] }))
      .rejects.toMatchObject({ diagnostic: expect.stringContaining("declared Media") });
  });

  it("does not let a block embed another Building Block", async () => {
    await expect(validateGeneratedBlockSource({ sourceCode: `import{CanvasBlock}from"@canvas/site-runtime";export default function B(){return <CanvasBlock blockId="${blockId}" usageKey="nested"/>}`, ...base, declaredMediaIds: [] }))
      .rejects.toMatchObject({ diagnostic: expect.stringContaining("custom component elements are not allowed") });
  });

  it.each([
    ["fetch", `export default function B(){fetch("/api/x");return <nav/>}`],
    ["XHR", `export default function B(){new XMLHttpRequest();return <nav/>}`],
    ["WebSocket", `export default function B(){new WebSocket("wss://x");return <nav/>}`],
    ["EventSource", `export default function B(){new EventSource("/x");return <nav/>}`],
    ["beacon", `export default function B(){navigator.sendBeacon("/x");return <nav/>}`],
    ["eval", `export default function B(){eval("1");return <nav/>}`],
    ["Function", `export default function B(){new Function("return 1");return <nav/>}`],
    ["dynamic import", `export default async function B(){await import("react");return <nav/>}`],
    ["require", `export default function B(){require("fs");return <nav/>}`],
    ["node API", `import fs from "node:fs";export default function B(){return <nav/>}`],
    ["arbitrary import", `import x from "lodash";export default function B(){return <nav/>}`],
    ["cookies", `export default function B(){document.cookie="x";return <nav/>}`],
    ["storage", `export default function B(){localStorage.getItem("x");return <nav/>}`],
    ["parent access", `export default function B(){window.parent.location.href="/";return <nav/>}`],
    ["opener access", `export default function B(){window.opener.focus();return <nav/>}`],
    ["unsafe HTML", `export default function B(){return <nav dangerouslySetInnerHTML={{__html:"x"}}/>}`],
    ["script", `export default function B(){return <script/>}`],
    ["iframe", `export default function B(){return <iframe/>}`],
    ["embed", `export default function B(){return <embed/>}`],
    ["remote image", `export default function B(){return <img src="https://remote.example/a.png"/>}`],
    ["endpoint form", `export default function B(){return <form action="https://remote.example"/>}`],
    ["javascript link", `export default function B(){return <a href="javascript:alert(1)">x</a>}`],
    ["malformed TSX", `export default function B(){return <nav>}`],
    ["no default export", `export function B(){return <nav/>}`],
  ])("rejects %s in block source", async (_name, sourceCode) => {
    await expect(validateGeneratedBlockSource({ sourceCode, ...base, declaredMediaIds: [] })).rejects.toMatchObject({ code: "AI_PROVIDER_INVALID_RESPONSE" });
  });

  it("rejects source larger than the generated-source limit", async () => {
    const sourceCode = `export default function B(){return <nav>${"x".repeat(110_000)}</nav>}`;
    await expect(validateGeneratedBlockSource({ sourceCode, ...base, declaredMediaIds: [] })).rejects.toMatchObject({ diagnostic: "source too large" });
  });
});

describe("page block references", () => {
  const page = (body: string) => `import { CanvasBlock } from "@canvas/site-runtime";\nexport default function Page(){return <main className="c-page">${body}</main>}`;

  it("extracts block usages and compiles the page together with the referenced blocks", async () => {
    const sourceCode = page(`<CanvasBlock blockId="${blockId}" usageKey="site-navbar" /><h1>About</h1>`);
    await expect(validateGeneratedSource({ kind: "page", sourceCode, ...withBlocks, declaredMediaIds: [], declaredBlockUsages: [{ blockId, usageKey: "site-navbar" }] }))
      .resolves.toMatchObject({ blockUsages: [{ blockId, usageKey: "site-navbar" }] });
  });

  it("allows the same block twice under distinct usage keys", async () => {
    const sourceCode = page(`<CanvasBlock blockId="${blockId}" usageKey="top-nav" /><CanvasBlock blockId="${blockId}" usageKey="bottom-nav" />`);
    const manifest = await validateGeneratedSource({ kind: "page", sourceCode, ...withBlocks, declaredMediaIds: [], declaredBlockUsages: [{ blockId, usageKey: "top-nav" }, { blockId, usageKey: "bottom-nav" }] });
    expect(manifest.blockUsages).toHaveLength(2);
  });

  it("rejects hallucinated block UUIDs", async () => {
    const hallucinated = "55555555-5555-4555-8555-555555555555";
    await expect(validateGeneratedSource({ kind: "page", sourceCode: page(`<CanvasBlock blockId="${hallucinated}" usageKey="nav" />`), ...withBlocks, declaredMediaIds: [], declaredBlockUsages: [{ blockId: hallucinated, usageKey: "nav" }] }))
      .rejects.toMatchObject({ diagnostic: expect.stringContaining("invalid block reference") });
  });

  it("rejects undeclared, duplicated, dynamic, and malformed usage references", async () => {
    await expect(validateGeneratedSource({ kind: "page", sourceCode: page(`<CanvasBlock blockId="${blockId}" usageKey="nav" />`), ...withBlocks, declaredMediaIds: [], declaredBlockUsages: [] }))
      .rejects.toMatchObject({ diagnostic: expect.stringContaining("declared Building Block usages") });
    await expect(validateGeneratedSource({ kind: "page", sourceCode: page(`<CanvasBlock blockId="${blockId}" usageKey="nav" /><CanvasBlock blockId="${otherBlockId}" usageKey="nav" />`), ...withBlocks, declaredMediaIds: [], declaredBlockUsages: [{ blockId, usageKey: "nav" }, { blockId: otherBlockId, usageKey: "nav" }] }))
      .rejects.toMatchObject({ diagnostic: expect.stringContaining("duplicate block usage key") });
    await expect(validateGeneratedSource({ kind: "page", sourceCode: page(`<CanvasBlock blockId={someId} usageKey="nav" />`), ...withBlocks, declaredMediaIds: [], declaredBlockUsages: [] }))
      .rejects.toMatchObject({ diagnostic: expect.stringContaining("CanvasBlock blockId must be a static UUID") });
    await expect(validateGeneratedSource({ kind: "page", sourceCode: page(`<CanvasBlock blockId="${blockId}" usageKey="Nav Key" />`), ...withBlocks, declaredMediaIds: [], declaredBlockUsages: [{ blockId, usageKey: "Nav Key" }] }))
      .rejects.toMatchObject({ diagnostic: expect.stringContaining("invalid block usage key") });
  });

  it("rejects a Canvas element ID on a Building Block reference", async () => {
    await expect(validateGeneratedSource({ kind: "page", sourceCode: page(`<CanvasBlock blockId="${blockId}" usageKey="nav" data-canvas-id="nav-region" />`), ...withBlocks, declaredMediaIds: [], declaredBlockUsages: [{ blockId, usageKey: "nav" }] }))
      .rejects.toMatchObject({ diagnostic: expect.stringContaining("cannot carry a Canvas element ID") });
  });

  it("rejects a reference whose block has no compiled source available", async () => {
    await expect(validateGeneratedSource({ kind: "page", sourceCode: page(`<CanvasBlock blockId="${blockId}" usageKey="nav" />`), ...base, availableBlockIds: new Set([blockId]), blockSources: new Map(), declaredMediaIds: [], declaredBlockUsages: [{ blockId, usageKey: "nav" }] }))
      .rejects.toMatchObject({ diagnostic: expect.stringContaining("has no active version") });
  });
});

describe("Canvas element IDs", () => {
  const wrap = (body: string) => `export default function Page(){return <main className="c-page">${body}</main>}`;

  it("collects stable editable elements with their type and label", async () => {
    const sourceCode = wrap(`<section data-canvas-id="hero-main" data-canvas-label="Hero"><h1 data-canvas-id="hero-title">Welcome</h1></section><article data-canvas-id="pricing-card-pro">Pro</article>`);
    const manifest = await validateGeneratedSource({ kind: "page", sourceCode, ...base, declaredMediaIds: [] });
    expect(manifest.editableElements).toEqual([
      { canvasId: "hero-main", elementType: "section", label: "Hero" },
      { canvasId: "hero-title", elementType: "h1", label: null },
      { canvasId: "pricing-card-pro", elementType: "article", label: null },
    ]);
  });

  it("collects editable elements inside Building Block source too", async () => {
    const manifest = await validateGeneratedBlockSource({ sourceCode: `export default function Block(){return <nav data-canvas-id="navbar-root"><a href="/contact" data-canvas-id="navbar-contact-link">Contact</a></nav>}`, ...base, declaredMediaIds: [] });
    expect(manifest.editableElements.map((element) => element.canvasId)).toEqual(["navbar-root", "navbar-contact-link"]);
  });

  it("rejects duplicate IDs within one generated entity", async () => {
    await expect(validateGeneratedSource({ kind: "page", sourceCode: wrap(`<section data-canvas-id="hero-main"/><section data-canvas-id="hero-main"/>`), ...base, declaredMediaIds: [] }))
      .rejects.toMatchObject({ diagnostic: expect.stringContaining("duplicate data-canvas-id values") });
  });

  it.each([
    ["uppercase", `<section data-canvas-id="HeroMain"/>`, "invalid data-canvas-id values"],
    ["spaces", `<section data-canvas-id="hero main"/>`, "invalid data-canvas-id values"],
    ["path traversal", `<section data-canvas-id="../secret"/>`, "invalid data-canvas-id values"],
    ["dynamic value", `<section data-canvas-id={id}/>`, "invalid data-canvas-id values"],
    ["dynamic label", `<section data-canvas-id="hero-main" data-canvas-label={name}/>`, "data-canvas-label must be a static string"],
  ])("rejects %s", async (_name, body, diagnostic) => {
    await expect(validateGeneratedSource({ kind: "page", sourceCode: wrap(body), ...base, declaredMediaIds: [] })).rejects.toMatchObject({ diagnostic: expect.stringContaining(diagnostic) });
  });

  it("lists every dynamic ID expression from the reproduced Gemini features response", async () => {
    const body = `<section data-canvas-id="features-section"><div data-canvas-id="features-grid">{features.map((feature)=><article data-canvas-id={\`feature-card-\${feature.id}\`}><h3 data-canvas-id={\`feature-title-\${feature.id}\`}>{feature.title}</h3><p data-canvas-id={\`feature-description-\${feature.id}\`}>{feature.description}</p></article>)}</div></section>`;
    await expect(validateGeneratedSource({ kind: "page", sourceCode: wrap(body), ...base, declaredMediaIds: [] })).rejects.toMatchObject({
      diagnostic: expect.stringMatching(/feature-card-.*feature-title-.*feature-description-/),
    });
  });

  it("lists all duplicate IDs and never accepts them silently", async () => {
    await expect(validateGeneratedSource({ kind: "page", sourceCode: wrap(`<section data-canvas-id="hero"/><section data-canvas-id="hero"/><article data-canvas-id="card-1"/><article data-canvas-id="card-1"/>`), ...base, declaredMediaIds: [] }))
      .rejects.toMatchObject({ diagnostic: "duplicate data-canvas-id values: hero, card-1" });
  });

  it("rejects over-long labels and more selectable elements than the limit", async () => {
    await expect(validateGeneratedSource({ kind: "page", sourceCode: wrap(`<section data-canvas-id="hero-main" data-canvas-label="${"x".repeat(81)}"/>`), ...base, declaredMediaIds: [] }))
      .rejects.toMatchObject({ diagnostic: "data-canvas-label is too long" });
    const many = Array.from({ length: 81 }, (_value, index) => `<section data-canvas-id="region-${index}"/>`).join("");
    await expect(validateGeneratedSource({ kind: "page", sourceCode: wrap(many), ...base, declaredMediaIds: [] }))
      .rejects.toMatchObject({ diagnostic: "too many selectable Canvas elements" });
  });

  it("keeps IDs stable across a modification that preserves the region", async () => {
    const first = await validateGeneratedSource({ kind: "page", sourceCode: wrap(`<section data-canvas-id="hero-main"><h1>Welcome</h1></section>`), ...base, declaredMediaIds: [] });
    const second = await validateGeneratedSource({ kind: "page", sourceCode: wrap(`<section data-canvas-id="hero-main"><h1>Welcome back</h1></section>`), ...base, declaredMediaIds: [] });
    expect(second.editableElements).toEqual(first.editableElements);
    expect(second.sourceHash).not.toBe(first.sourceHash);
  });
});
