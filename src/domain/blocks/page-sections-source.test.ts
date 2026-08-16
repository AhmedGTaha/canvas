import { describe, expect, it } from "vitest";
import { existingUsageKeys, insertBlockUsageIntoSource, PageSourceEditError, removeBlockUsageFromSource, usageKeyFor } from "./page-sections-source";

const NAVBAR = "11111111-1111-4111-8111-111111111111";
const FOOTER = "22222222-2222-4222-8222-222222222222";

const PAGE = `import { CanvasBlock } from "@canvas/site-runtime";

export default function HomePage() {
  return (
    <div className="c-page">
      <CanvasBlock blockId="${NAVBAR}" usageKey="site-navbar" />
      <section className="c-section c-hero" data-canvas-id="hero">
        <div className="c-container c-stack">
          <h1>Fresh pasta, made every morning</h1>
        </div>
      </section>
      <CanvasBlock blockId="${FOOTER}" usageKey="site-footer" />
    </div>
  );
}
`;

describe("page section source edits", () => {
  it("reads every usage key on the page", () => {
    expect(existingUsageKeys(PAGE)).toEqual(["site-navbar", "site-footer"]);
  });

  it("removes the reference for one usage and leaves the rest byte-for-byte", () => {
    const next = removeBlockUsageFromSource(PAGE, "site-navbar");
    expect(next).not.toContain("site-navbar");
    expect(existingUsageKeys(next)).toEqual(["site-footer"]);
    // The hero and the footer reference are untouched.
    expect(next).toContain("Fresh pasta, made every morning");
    expect(next).toContain(`<CanvasBlock blockId="${FOOTER}" usageKey="site-footer" />`);
    // No blank line is left where the element was.
    expect(next).not.toMatch(/\n\s*\n\s*<section/);
  });

  it("refuses to remove a usage the page does not have", () => {
    expect(() => removeBlockUsageFromSource(PAGE, "nope")).toThrow(PageSourceEditError);
  });

  it("removes only the named usage when a block appears twice", () => {
    const twice = insertBlockUsageIntoSource(PAGE, { blockId: NAVBAR, usageKey: "site-navbar-2", placement: { position: "bottom" } });
    const next = removeBlockUsageFromSource(twice, "site-navbar-2");
    expect(existingUsageKeys(next)).toEqual(["site-navbar", "site-footer"]);
  });

  it("inserts at the top of the page", () => {
    const next = insertBlockUsageIntoSource(removeBlockUsageFromSource(PAGE, "site-navbar"), { blockId: NAVBAR, usageKey: "site-navbar", placement: { position: "top" } });
    expect(existingUsageKeys(next)).toEqual(["site-navbar", "site-footer"]);
    expect(next.indexOf("site-navbar")).toBeLessThan(next.indexOf("hero"));
  });

  it("inserts at the bottom of the page", () => {
    const next = insertBlockUsageIntoSource(PAGE, { blockId: FOOTER, usageKey: "closing-cta", placement: { position: "bottom" } });
    expect(existingUsageKeys(next)).toEqual(["site-navbar", "site-footer", "closing-cta"]);
  });

  it("inserts before and after a selected section", () => {
    const before = insertBlockUsageIntoSource(PAGE, { blockId: FOOTER, usageKey: "pre-hero", placement: { position: "before", anchor: "hero" } });
    expect(existingUsageKeys(before)).toEqual(["site-navbar", "pre-hero", "site-footer"]);
    const after = insertBlockUsageIntoSource(PAGE, { blockId: FOOTER, usageKey: "post-hero", placement: { position: "after", anchor: "hero" } });
    expect(existingUsageKeys(after)).toEqual(["site-navbar", "post-hero", "site-footer"]);
  });

  it("treats a nested selection as its containing section", () => {
    // "hero" is on the section; a selection deeper inside still places beside the section.
    const nested = PAGE.replace('<h1>', '<h1 data-canvas-id="hero-title">');
    const after = insertBlockUsageIntoSource(nested, { blockId: FOOTER, usageKey: "post-hero", placement: { position: "after", anchor: "hero-title" } });
    expect(existingUsageKeys(after)).toEqual(["site-navbar", "post-hero", "site-footer"]);
  });

  it("places beside an existing reusable section, not inside it", () => {
    const after = insertBlockUsageIntoSource(PAGE, { blockId: FOOTER, usageKey: "under-nav", placement: { position: "after", anchor: "site-navbar" } });
    expect(existingUsageKeys(after)).toEqual(["site-navbar", "under-nav", "site-footer"]);
  });

  it("rejects an anchor that is no longer on the page", () => {
    expect(() => insertBlockUsageIntoSource(PAGE, { blockId: FOOTER, usageKey: "x", placement: { position: "after", anchor: "gone" } })).toThrow(PageSourceEditError);
  });

  it("derives contract-valid, unique usage keys", () => {
    expect(usageKeyFor("Site Navbar", [])).toBe("site-navbar");
    expect(usageKeyFor("Site Navbar", ["site-navbar"])).toBe("site-navbar-2");
    expect(usageKeyFor("Site Navbar", ["site-navbar", "site-navbar-2"])).toBe("site-navbar-3");
    expect(usageKeyFor("!!!", [])).toBe("section");
  });

  it("adds a first section to an otherwise empty page root", () => {
    const empty = `export default function Empty() {\n  return (\n    <div className="c-page">\n    </div>\n  );\n}\n`;
    const next = insertBlockUsageIntoSource(empty, { blockId: NAVBAR, usageKey: "site-navbar", placement: { position: "top" } });
    expect(existingUsageKeys(next)).toEqual(["site-navbar"]);
  });

  /*
   * Found by running the real product: `<CanvasBlock />` is an ordinary identifier after
   * compilation, so a page that referenced it without importing it compiled fine and then
   * threw "CanvasBlock is not defined" in the Preview.
   */
  describe("the runtime import", () => {
    const BARE = `export default function Home() {\n  return (\n    <div className="c-page">\n      <section data-canvas-id="hero"><h1>Hi</h1></section>\n    </div>\n  );\n}\n`;

    it("is added when the page did not reference a block before", () => {
      const next = insertBlockUsageIntoSource(BARE, { blockId: NAVBAR, usageKey: "site-navbar", placement: { position: "top" } });
      expect(next).toContain('import { CanvasBlock } from "@canvas/site-runtime";');
      expect(next.indexOf("import")).toBeLessThan(next.indexOf("<CanvasBlock"));
    });

    it("is added below a use client directive, not above it", () => {
      const client = `"use client";\nimport { useState } from "react";\n${BARE}`;
      const next = insertBlockUsageIntoSource(client, { blockId: NAVBAR, usageKey: "site-navbar", placement: { position: "top" } });
      expect(next.indexOf('"use client"')).toBe(0);
      expect(next).toContain('import { CanvasBlock } from "@canvas/site-runtime";');
    });

    it("joins an existing runtime import instead of adding a second one", () => {
      const withImage = `import { CanvasImage } from "@canvas/site-runtime";\n${BARE}`;
      const next = insertBlockUsageIntoSource(withImage, { blockId: NAVBAR, usageKey: "site-navbar", placement: { position: "top" } });
      expect(next).toContain('import { CanvasImage, CanvasBlock } from "@canvas/site-runtime";');
      expect(next.match(/@canvas\/site-runtime/g)).toHaveLength(1);
    });


    it("is dropped again when the last section is removed", () => {
      const next = removeBlockUsageFromSource(removeBlockUsageFromSource(PAGE, "site-navbar"), "site-footer");
      expect(next).not.toContain("CanvasBlock");
      expect(next).not.toContain("@canvas/site-runtime");
      expect(next).toContain("Fresh pasta, made every morning");
    });

    it("is kept while any section remains, and never takes another binding with it", () => {
      const oneLeft = removeBlockUsageFromSource(PAGE, "site-navbar");
      expect(oneLeft).toContain('import { CanvasBlock } from "@canvas/site-runtime";');

      const withImage = PAGE.replace('import { CanvasBlock }', 'import { CanvasImage, CanvasBlock }');
      const stripped = removeBlockUsageFromSource(removeBlockUsageFromSource(withImage, "site-navbar"), "site-footer");
      expect(stripped).toContain('import { CanvasImage } from "@canvas/site-runtime";');
      expect(stripped).not.toContain("CanvasBlock");
    });

    it("is left alone when the page already imports it", () => {
      const next = insertBlockUsageIntoSource(PAGE, { blockId: NAVBAR, usageKey: "extra", placement: { position: "bottom" } });
      expect(next.match(/@canvas\/site-runtime/g)).toHaveLength(1);
      expect(next.match(/CanvasBlock,|, CanvasBlock/g)).toBeNull();
    });
  });
});
