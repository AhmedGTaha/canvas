import { describe, expect, it } from "vitest";
import { designScaleSchema, hexColorSchema, parseStoredThemeSettings, semanticColorTokensSchema, themeSettingsSchema } from "./schemas";
import { DEFAULT_DARK_TOKENS, DEFAULT_LIGHT_TOKENS, DEFAULT_THEME } from "./defaults";

describe("theme validation", () => {
  it.each(["#000000", "#FFFFFF", "#1A2B3C"])("accepts %s", (color) => expect(hexColorSchema.parse(color)).toBe(color));
  it("normalizes valid colors to uppercase", () => expect(hexColorSchema.parse("#1a2b3c")).toBe("#1A2B3C"));
  it.each(["red", "rgb(0,0,0)", "#FFF", "url(example)", "#GGGGGG", ""])("rejects %s", (color) => expect(hexColorSchema.safeParse(color).success).toBe(false));

  it.each([0, 50, 100])("accepts scale %s", (scale) => expect(designScaleSchema.parse(scale)).toBe(scale));
  it.each([-1, 101, Number.NaN, Number.POSITIVE_INFINITY, "50"])("rejects invalid scale %s", (scale) => expect(designScaleSchema.safeParse(scale).success).toBe(false));

  it("requires exactly the supported semantic keys", () => {
    expect(semanticColorTokensSchema.parse(DEFAULT_LIGHT_TOKENS)).toEqual(DEFAULT_LIGHT_TOKENS);
    expect(semanticColorTokensSchema.safeParse({ ...DEFAULT_LIGHT_TOKENS, custom: "#000000" }).success).toBe(false);
    const missingBorder = Object.fromEntries(Object.entries(DEFAULT_LIGHT_TOKENS).filter(([key]) => key !== "border"));
    expect(semanticColorTokensSchema.safeParse(missingBorder).success).toBe(false);
  });

  it("keeps complete valid light, dark, and scale defaults", () => {
    expect(themeSettingsSchema.parse(DEFAULT_THEME)).toEqual(DEFAULT_THEME);
    expect(Object.keys(DEFAULT_LIGHT_TOKENS)).toHaveLength(8);
    expect(Object.keys(DEFAULT_DARK_TOKENS)).toHaveLength(8);
  });

  it("extracts theme input from a persistence record with metadata", () => {
    const parsed = parseStoredThemeSettings({ ...DEFAULT_THEME, projectId: "ignored", revision: 9 } as typeof DEFAULT_THEME & { projectId: string; revision: number });
    expect(parsed).toMatchObject({ success: true, data: DEFAULT_THEME });
  });
});
