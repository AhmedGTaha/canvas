import { describe, expect, it } from "vitest";
import { findThemePreset, THEME_PRESETS } from "./presets";
import { resolveProjectDesignTokens } from "./resolver";
import { semanticColorTokensSchema, themeSettingsSchema } from "./schemas";

const COLOR_KEYS = Object.keys(semanticColorTokensSchema.shape) as Array<keyof typeof semanticColorTokensSchema.shape>;

/** Relative luminance per WCAG 2.1, used for the contrast floor below. */
function luminance(hex: string) {
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}
function contrast(a: string, b: string) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high! + 0.05) / (low! + 0.05);
}

describe("curated theme presets", () => {
  it("ships between 12 and 15 presets with unique ids", () => {
    expect(THEME_PRESETS.length).toBeGreaterThanOrEqual(12);
    expect(THEME_PRESETS.length).toBeLessThanOrEqual(15);
    expect(new Set(THEME_PRESETS.map((preset) => preset.id)).size).toBe(THEME_PRESETS.length);
    expect(new Set(THEME_PRESETS.map((preset) => preset.name)).size).toBe(THEME_PRESETS.length);
  });

  it("covers restrained and expressive options", () => {
    const tones = new Set(THEME_PRESETS.map((preset) => preset.tone));
    expect(tones.has("restrained")).toBe(true);
    expect(tones.has("expressive")).toBe(true);
  });

  it.each(THEME_PRESETS.map((preset) => [preset.id, preset] as const))("%s is a complete, valid theme", (_id, preset) => {
    const parsed = themeSettingsSchema.safeParse(preset.theme);
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error?.issues)).toBe(true);
    for (const key of COLOR_KEYS) {
      expect(preset.theme.lightTokens[key]).toMatch(/^#[0-9A-F]{6}$/);
      expect(preset.theme.darkTokens[key]).toMatch(/^#[0-9A-F]{6}$/);
    }
    // Every scale is present and inside the design-scale range the resolver expects.
    for (const scale of ["radiusScale", "spacingScale", "shadowScale", "fontScale", "borderScale"] as const) {
      expect(preset.theme[scale]).toBeGreaterThanOrEqual(0);
      expect(preset.theme[scale]).toBeLessThanOrEqual(100);
    }
    // A preset must resolve to real design tokens, because that is all a generated
    // page ever sees of it.
    expect(() => resolveProjectDesignTokens(preset.theme)).not.toThrow();
  });

  it.each(THEME_PRESETS.map((preset) => [preset.id, preset] as const))("%s keeps body text readable in both schemes", (_id, preset) => {
    for (const tokens of [preset.theme.lightTokens, preset.theme.darkTokens]) {
      expect(contrast(tokens.text, tokens.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(tokens.text, tokens.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(tokens.mutedText, tokens.background)).toBeGreaterThanOrEqual(4.5);
      // c-button paints background-on-primary, so that pair carries real text too.
      expect(contrast(tokens.background, tokens.primary)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("resolves presets by id and rejects unknown ids", () => {
    expect(findThemePreset("canvas-neutral")?.name).toBe("Canvas Neutral");
    expect(findThemePreset("not-a-preset")).toBeNull();
  });
});
