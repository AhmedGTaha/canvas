import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The Design screen must communicate a Theme as a visual language, not a page layout.
 * These guard the copy so it cannot silently drift back to "Complete designs" wording that
 * implied selecting a style selects a whole webpage template.
 */
const editor = readFileSync(fileURLToPath(new URL("./theme-editor.tsx", import.meta.url)), "utf8");
const presets = readFileSync(fileURLToPath(new URL("./theme-presets.tsx", import.meta.url)), "utf8");

describe("theme visual-language wording", () => {
  it("presents styles as visual treatment, not a page layout", () => {
    expect(editor).toContain("Visual styles");
    expect(editor).toContain("not its page layout or section order");
  });

  it("drops the old full-page-design wording", () => {
    expect(editor).not.toContain("Complete designs");
    expect(editor).not.toContain("Ready-made themes");
    expect(presets).not.toContain("ready-made theme picker");
  });
});
