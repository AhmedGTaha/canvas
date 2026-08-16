/** @vitest-environment jsdom */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CanvasLogo } from "@/components/brand/canvas-logo";
import { APPEARANCES, DEFAULT_APPEARANCE, appearanceAttribute, parseAppearance } from "@/domain/appearance/model";

afterEach(cleanup);

const tokens = readFileSync("src/app/tokens.css", "utf8");
const base = readFileSync("src/app/base.css", "utf8");

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sources(target);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [target] : [];
  });
}
const componentFiles = sources("src/components").concat(sources("src/app"));

describe("appearance", () => {
  it("treats the system setting as the default and as the absence of an attribute", () => {
    // "system" writing no attribute is what lets base.css resolve it from the
    // device with no script, which is what makes it flash-free.
    expect(DEFAULT_APPEARANCE).toBe("system");
    expect(appearanceAttribute("system")).toBeUndefined();
    expect(appearanceAttribute("light")).toBe("light");
    expect(appearanceAttribute("dark")).toBe("dark");
  });

  it("falls back to the system setting rather than trusting a cookie", () => {
    for (const value of APPEARANCES) expect(parseAppearance(value)).toBe(value);
    for (const value of [null, undefined, "", "DARK", "midnight", "light-dark"]) {
      expect(parseAppearance(value), `${String(value)} should not be honoured`).toBe("system");
    }
  });

  it("switches the whole product from one declaration", () => {
    // color-scheme is what resolves every light-dark() token *and* what the
    // browser reads for scrollbars and native controls, so the two cannot
    // disagree — there is nothing else to keep in step.
    expect(base).toMatch(/:root \{ color-scheme: light dark; \}/);
    expect(base).toMatch(/:root\[data-appearance="light"\] \{ color-scheme: light; \}/);
    expect(base).toMatch(/:root\[data-appearance="dark"\] \{ color-scheme: dark; \}/);
  });

  it("gives every semantic colour token both appearances", () => {
    // A semantic token with a single value is a colour that will be wrong in one
    // appearance. Primitives are exempt: they are the two ramps themselves.
    const semantics = tokens.slice(tokens.indexOf("2. semantics"), tokens.indexOf("3. legacy"));
    const singleValued = [...semantics.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{3,6}|rgba?\([^)]*\))\s*;/g)]
      .map((match) => match[1]!)
      // The preview's paper is deliberately one value: it belongs to the user's
      // website, not to the appearance of Canvas.
      .filter((name) => name !== "--preview-paper");
    expect(singleValued, `${singleValued.join(", ")} exist in only one appearance`).toHaveLength(0);
  });

  it("eases the switch instead of cutting it, and only while it happens", () => {
    // Armed by an attribute the control removes again, and never at all for
    // someone who has asked for reduced motion.
    expect(base).toContain("@media (prefers-reduced-motion: no-preference)");
    expect(base).toContain(":root[data-appearance-changing] *");
  });
});

describe("the Canvas logo", () => {
  it("carries the product name whether or not the wordmark is shown", () => {
    render(<><CanvasLogo /><CanvasLogo variant="mark" /></>);
    expect(screen.getAllByText("Canvas")).toHaveLength(2);
  });

  it("draws the mark as artwork, and keeps it out of the accessibility tree", () => {
    const { container } = render(<CanvasLogo variant="mark" />);
    const mark = container.querySelector("svg.canvas-logo-mark")!;
    expect(mark.getAttribute("aria-hidden")).toBe("true");
    // Geometry, not a letter in whatever font happens to load.
    expect(mark.querySelector("path.canvas-logo-c")).toBeTruthy();
  });

  it("is the only implementation of the mark in the product", () => {
    // Canvas had four: a typed "C" on the auth screen, the same on the
    // dashboard bar, another in the workspace loading skeleton, and a borrowed
    // Command glyph in the title bar. Any new one is caught here.
    const offenders = componentFiles.filter((file) => {
      if (file.endsWith("canvas-logo.tsx")) return false;
      const source = readFileSync(file, "utf8");
      return /brand-mark|ws-mark|className="[^"]*\bbrand\b[^"]*">C</.test(source);
    });
    expect(offenders, `${offenders.join(", ")} draw their own Canvas mark`).toHaveLength(0);
  });
});
