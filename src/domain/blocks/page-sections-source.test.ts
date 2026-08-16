import { describe, expect, it } from "vitest";
import { existingUsageKeys, insertBlockUsageIntoSource, PageSourceEditError, removeBlockUsageFromSource, usageKeyFor } from "./page-sections-source";

const blockId = "11111111-1111-4111-8111-111111111111";
const otherBlockId = "22222222-2222-4222-8222-222222222222";

const host = (id: string, key: string) => `<div data-canvas-block="${id}" data-canvas-usage="${key}"></div>`;

const page = `<div class="c-page" data-canvas-id="page">${host(blockId, "site-navbar")}<section data-canvas-id="hero"><h1>Welcome</h1></section><section data-canvas-id="pricing"><article data-canvas-id="plan-pro">Pro</article></section>${host(otherBlockId, "site-footer")}</div>`;

describe("page section edits", () => {
  it("reads every usage key on the page, in document order", () => {
    expect(existingUsageKeys(page)).toEqual(["site-navbar", "site-footer"]);
    expect(existingUsageKeys(`<main data-canvas-id="p"><h1>x</h1></main>`)).toEqual([]);
  });

  it("derives a stable, contract-valid usage key from a section name", () => {
    expect(usageKeyFor("Global Navbar", [])).toBe("global-navbar");
    expect(usageKeyFor("Global Navbar", ["global-navbar"])).toBe("global-navbar-2");
    expect(usageKeyFor("!!!", [])).toBe("section");
  });

  it("removes one usage and leaves every other section intact", () => {
    const result = removeBlockUsageFromSource(page, "site-navbar");
    expect(result).not.toContain("site-navbar");
    expect(result).toContain(host(otherBlockId, "site-footer"));
    expect(result).toContain(`<section data-canvas-id="hero"><h1>Welcome</h1></section>`);
  });

  it("removes only the named usage when the same block is used twice", () => {
    const twice = `<div class="c-page" data-canvas-id="p">${host(blockId, "top-nav")}${host(blockId, "bottom-nav")}</div>`;
    const result = removeBlockUsageFromSource(twice, "top-nav");
    expect(result).toContain("bottom-nav");
    expect(result).not.toContain("top-nav");
  });

  it("reports a usage that is not on the page", () => {
    expect(() => removeBlockUsageFromSource(page, "nope")).toThrowError(PageSourceEditError);
  });

  it("inserts at the top and at the bottom of the page", () => {
    const top = insertBlockUsageIntoSource(page, { blockId, usageKey: "banner", placement: { position: "top" } });
    expect(top.indexOf("banner")).toBeLessThan(top.indexOf("site-navbar"));

    const bottom = insertBlockUsageIntoSource(page, { blockId, usageKey: "banner", placement: { position: "bottom" } });
    expect(bottom.indexOf("banner")).toBeGreaterThan(bottom.indexOf("site-footer"));
  });

  it("inserts before and after a selected section", () => {
    const before = insertBlockUsageIntoSource(page, { blockId, usageKey: "banner", placement: { position: "before", anchor: "hero" } });
    expect(before.indexOf("banner")).toBeLessThan(before.indexOf(`data-canvas-id="hero"`));

    const after = insertBlockUsageIntoSource(page, { blockId, usageKey: "banner", placement: { position: "after", anchor: "hero" } });
    expect(after.indexOf("banner")).toBeGreaterThan(after.indexOf(`data-canvas-id="hero"`));
    expect(after.indexOf("banner")).toBeLessThan(after.indexOf(`data-canvas-id="pricing"`));
  });

  it("treats a nested selection as its containing section", () => {
    const result = insertBlockUsageIntoSource(page, { blockId, usageKey: "banner", placement: { position: "after", anchor: "plan-pro" } });
    // The new section lands after the whole pricing section, not inside it.
    expect(result.indexOf("banner")).toBeGreaterThan(result.indexOf("Pro"));
    expect(result).toContain(`<article data-canvas-id="plan-pro">Pro</article></section>`);
  });

  it("places beside an existing reusable section rather than inside it", () => {
    const result = insertBlockUsageIntoSource(page, { blockId, usageKey: "banner", placement: { position: "after", anchor: "site-navbar" } });
    expect(result).toContain(`${host(blockId, "site-navbar")}${host(blockId, "banner")}`);
  });

  it("reports an anchor that is no longer on the page", () => {
    expect(() => insertBlockUsageIntoSource(page, { blockId, usageKey: "banner", placement: { position: "after", anchor: "gone" } }))
      .toThrowError(PageSourceEditError);
  });

  it("fills an empty page shell with its first section", () => {
    const shell = `<div class="c-page" data-canvas-id="page-root"></div>`;
    const result = insertBlockUsageIntoSource(shell, { blockId, usageKey: "site-navbar", placement: { position: "bottom" } });
    expect(result).toBe(`<div class="c-page" data-canvas-id="page-root">${host(blockId, "site-navbar")}</div>`);
  });

  it("refuses markup it cannot read rather than guessing at it", () => {
    expect(() => existingUsageKeys(`<main><section></main>`)).toThrowError(PageSourceEditError);
  });
});
