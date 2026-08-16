import { describe, expect, it } from "vitest";
import { validateGeneratedDocument } from "./validator";
import type { GeneratedDocument } from "./document";

const mediaId = "11111111-1111-4111-8111-111111111111";
const blockId = "22222222-2222-4222-8222-222222222222";
const context = { approvedMediaIds: new Set([mediaId]), activeRoutes: new Set(["/", "/contact"]) };

function document(overrides: Partial<GeneratedDocument> = {}): GeneratedDocument {
  return {
    schemaVersion: 1,
    html: `<main class="c-page" data-canvas-id="page"><h1>Welcome</h1></main>`,
    css: "",
    js: "",
    metadata: { title: "Home", description: null },
    ...overrides,
  };
}

const page = (overrides: Partial<GeneratedDocument> = {}, extra: Record<string, unknown> = {}) =>
  validateGeneratedDocument({ kind: "page", document: document(overrides), ...context, ...extra });

describe("generated document validation", () => {
  it("accepts a page with markup, styles, behaviour, media, links, and a block host", () => {
    const result = page({
      html: `<main class="c-page" data-canvas-id="page" data-canvas-label="Page">
        <div data-canvas-block="${blockId}" data-canvas-usage="site-navbar"></div>
        <section class="c-section hero-band" data-canvas-id="hero">
          <h1>Welcome</h1>
          <img data-canvas-media="${mediaId}" alt="Our workshop" class="c-media">
          <a class="c-button" href="/contact">Contact</a>
          <a class="c-link" href="#hero">Top</a>
          <a class="c-link" href="https://example.com">External</a>
          <button type="button" class="c-button-secondary" aria-expanded="false" aria-controls="panel">More</button>
          <div id="panel" hidden>Details</div>
        </section>
      </main>`,
      css: `.hero-band{background:var(--color-surface);padding:var(--space-lg)}@media (min-width:640px){.hero-band{padding:var(--space-xl)}}`,
      js: `var control = document.querySelector(".c-button-secondary");
var panel = document.getElementById("panel");
if (control && panel) control.addEventListener("click", function () { panel.removeAttribute("hidden"); });`,
    }, { declaredMediaIds: [mediaId], availableBlockIds: new Set([blockId]), declaredBlockUsages: [{ blockId, usageKey: "site-navbar" }] });

    expect(result.manifest).toMatchObject({
      referencedMediaIds: [mediaId],
      internalRoutes: ["/contact"],
      externalLinks: ["https://example.com"],
      usesClientInteractivity: true,
      runtimeVersion: 2,
      blockUsages: [{ blockId, usageKey: "site-navbar" }],
      elementIds: ["panel"],
    });
    expect(result.manifest.editableElements.map(({ canvasId }) => canvasId)).toEqual(["page", "hero"]);
    // The stored markup is re-printed from the parsed tree, never the model's bytes.
    expect(result.document.html).toContain(`<img data-canvas-media="${mediaId}" alt="Our workshop" class="c-media">`);
    expect(result.document.html).not.toContain("\n      ");
  });

  it("stores an empty stylesheet and script when the document has none", () => {
    const result = page();
    expect(result.document.css).toBe("");
    expect(result.document.js).toBe("");
    expect(result.manifest.usesClientInteractivity).toBe(false);
  });

  it.each([
    ["a script element", `<main data-canvas-id="p"><script>alert(1)</script></main>`],
    ["an iframe", `<main data-canvas-id="p"><iframe src="https://x.example"></iframe></main>`],
    ["an object element", `<main data-canvas-id="p"><object data="x"></object></main>`],
    ["inline svg", `<main data-canvas-id="p"><svg><circle r="4"></circle></svg></main>`],
    ["a style element", `<main data-canvas-id="p"><style>body{}</style></main>`],
    ["a link element", `<main data-canvas-id="p"><link rel="stylesheet" href="x.css"></main>`],
    ["an inline handler", `<main data-canvas-id="p"><button onclick="alert(1)">x</button></main>`],
    ["an inline style attribute", `<main data-canvas-id="p" style="color:red"><h1>x</h1></main>`],
    ["a javascript: link", `<main data-canvas-id="p"><a href="javascript:alert(1)">x</a></main>`],
    ["a data: link", `<main data-canvas-id="p"><a href="data:text/html,<script>">x</a></main>`],
    ["a link to a route that does not exist", `<main data-canvas-id="p"><a href="/pricing">x</a></main>`],
    ["an unclosed element", `<main data-canvas-id="p"><section><h1>x</h1></main>`],
    ["a mismatched closing tag", `<main data-canvas-id="p"><section><h1>x</section></h1></main>`],
    ["an HTML comment", `<main data-canvas-id="p"><!-- hidden --><h1>x</h1></main>`],
    ["an obfuscated character reference", `<main data-canvas-id="p"><h1>&#x3c;script&#x3e;</h1></main>`],
    ["a form that posts somewhere", `<main data-canvas-id="p"><form action="https://x.example" method="post"></form></main>`],
    ["an image with a remote src", `<main data-canvas-id="p"><img src="https://remote.example/x.jpg" alt="x"></main>`],
    ["an image with no alt text", `<main data-canvas-id="p"><img data-canvas-media="${mediaId}"></main>`],
    ["a document with no editable regions", `<main class="c-page"><h1>x</h1></main>`],
    ["a duplicate Canvas element id", `<main data-canvas-id="p"><section data-canvas-id="p"></section></main>`],
    ["a malformed Canvas element id", `<main data-canvas-id="Hero Section"><h1>x</h1></main>`],
    ["a duplicate element id", `<main data-canvas-id="p"><div id="x"></div><div id="x"></div></main>`],
  ])("rejects %s", (_name, html) => {
    expect(() => page({ html }, { declaredMediaIds: [] })).toThrowError(expect.objectContaining({ code: "AI_GENERATED_DOCUMENT_INVALID" }));
  });

  it.each([
    ["fetch", `fetch("/api/x");`],
    ["eval", `eval("1");`],
    ["new Function", `new Function("return 1")();`],
    ["localStorage", `localStorage.setItem("a", "b");`],
    ["document.cookie", `document.cookie = "a=b";`],
    ["innerHTML", `document.querySelector("h1").innerHTML = "<b>x</b>";`],
    ["document.write", `document.write("x");`],
    ["createElement", `var node = document.createElement("script");`],
    ["parent access", `parent.postMessage("x", "*");`],
    ["location", `location.href = "https://x.example";`],
    ["an import", `import x from "y";`],
    ["a Canvas attribute", `document.querySelector("h1").setAttribute("data-canvas-id", "fake");`],
    ["a Canvas attribute in a selector", `document.querySelector("[data-canvas-id=hero]");`],
    ["a timer taking code as a string", `setTimeout("alert(1)", 10);`],
    ["a dynamic attribute name", `document.querySelector("h1").setAttribute(window.name, "x");`],
  ])("rejects JavaScript that uses %s", (_name, js) => {
    expect(() => page({ js })).toThrowError(expect.objectContaining({ code: "AI_GENERATED_DOCUMENT_INVALID" }));
  });

  it.each([
    ["@import", `@import url("https://fonts.example/x.css");`],
    ["url()", `.a{background:url(https://x.example/y.png)}`],
    ["a body selector", `body{display:none}`],
    ["a :root selector", `:root{--color-primary:#000}`],
    ["position: fixed", `.a{position:fixed;inset:0}`],
    ["@font-face", `@font-face{font-family:x;src:local(x)}`],
    ["an unbalanced brace", `.a{color:red`],
    ["a data-canvas selector", `[data-canvas-id]{display:none}`],
  ])("rejects CSS that uses %s", (_name, css) => {
    expect(() => page({ css })).toThrowError(expect.objectContaining({ code: "AI_GENERATED_DOCUMENT_INVALID" }));
  });

  it("rejects hallucinated and mismatched Media references", () => {
    const foreign = "33333333-3333-4333-8333-333333333333";
    expect(() => page({ html: `<main data-canvas-id="p"><img data-canvas-media="${foreign}" alt="x"></main>` }, { declaredMediaIds: [foreign] }))
      .toThrowError(expect.objectContaining({ diagnostic: expect.stringContaining("invalid media ID") }));
    expect(() => page({}, { declaredMediaIds: [mediaId] }))
      .toThrowError(expect.objectContaining({ diagnostic: expect.stringContaining("declared Media") }));
  });

  it("rejects a block reference the project did not authorise, and one inside a block", () => {
    const html = `<main data-canvas-id="p"><div data-canvas-block="${blockId}" data-canvas-usage="nav"></div></main>`;
    expect(() => page({ html }, { availableBlockIds: new Set(), declaredBlockUsages: [{ blockId, usageKey: "nav" }] }))
      .toThrowError(expect.objectContaining({ diagnostic: expect.stringContaining("invalid block reference") }));
    expect(() => validateGeneratedDocument({ kind: "block", document: document({ html }), ...context, declaredMediaIds: [] }))
      .toThrowError(expect.objectContaining({ diagnostic: expect.stringContaining("Building Blocks cannot contain other Building Blocks") }));
  });

  it("rejects declared block usages that disagree with the markup", () => {
    const html = `<main data-canvas-id="p"><div data-canvas-block="${blockId}" data-canvas-usage="nav"></div></main>`;
    expect(() => page({ html }, { availableBlockIds: new Set([blockId]), declaredBlockUsages: [{ blockId, usageKey: "footer" }] }))
      .toThrowError(expect.objectContaining({ diagnostic: expect.stringContaining("declared Building Block usages") }));
  });

  it("names the stage that rejected the document", () => {
    expect(() => page({ css: "body{display:none}" })).toThrowError(expect.objectContaining({ diagnostic: expect.stringContaining("unsafe CSS") }));
    expect(() => page({ js: "fetch('/x')" })).toThrowError(expect.objectContaining({ diagnostic: expect.stringContaining("unsafe JavaScript") }));
    expect(() => page({ html: `<main data-canvas-id="p"><script></script></main>` })).toThrowError(expect.objectContaining({ diagnostic: expect.stringContaining("prohibited element") }));
    // The compile stage is gone, so nothing can report a compile failure any more.
    expect(() => page({ html: "<main" })).toThrowError(expect.objectContaining({ message: expect.not.stringContaining("compiled") }));
  });

  it("reports every unresolvable internal route in one diagnostic", () => {
    expect(() => page({ html: `<main data-canvas-id="p"><a href="/pricing">a</a><a href="/team">b</a></main>` }))
      .toThrowError(expect.objectContaining({ message: expect.stringContaining("do not exist in this project yet") }));
  });

  it("rejects a document larger than the contract allows", () => {
    expect(() => page({ html: `<main data-canvas-id="p"><p>${"x".repeat(160_001)}</p></main>` }))
      .toThrowError(expect.objectContaining({ diagnostic: "document too large" }));
  });

  it("keeps a Building Block fragment free of page metadata", () => {
    const result = validateGeneratedDocument({ kind: "block", document: document(), ...context });
    expect(result.document.metadata).toBeNull();
  });
});
