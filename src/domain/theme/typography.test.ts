import { describe, expect, it } from "vitest";
import { DEFAULT_BODY_FONT, DEFAULT_HEADING_FONT, FONT_CHOICES, findFontChoice, resolveFontStack } from "./fonts";
import { DEFAULT_THEME } from "./defaults";
import { THEME_PRESETS } from "./presets";
import { projectThemeCssVariables, resolveProjectDesignTokens } from "./resolver";
import { fontChoiceSchema, parseStoredThemeSettings, themeSettingsColumns, themeSettingsSchema, typographySettingsSchema } from "./schemas";
import { EXPORT_BASE_CSS, GENERATED_RUNTIME_CSS, themeScaleDeclarations } from "@/generated-runtime/preview/runtime-css";

const themeWith = (headingFont: string, bodyFont: string) => ({ ...DEFAULT_THEME, typography: { headingFont, bodyFont } }) as typeof DEFAULT_THEME;

describe("project font catalogue", () => {
  it("is curated, unique, and small enough to choose from", () => {
    expect(FONT_CHOICES.length).toBeGreaterThanOrEqual(8);
    expect(FONT_CHOICES.length).toBeLessThanOrEqual(20);
    expect(new Set(FONT_CHOICES.map((font) => font.id)).size).toBe(FONT_CHOICES.length);
    expect(new Set(FONT_CHOICES.map((font) => font.label)).size).toBe(FONT_CHOICES.length);
  });

  it("covers the families a business site actually needs", () => {
    const ids = FONT_CHOICES.map((font) => font.id);
    for (const id of ["system-sans", "arial", "helvetica", "verdana", "tahoma", "trebuchet-ms", "georgia", "times-new-roman", "garamond", "courier-new"]) {
      expect(ids, `missing ${id}`).toContain(id);
    }
    for (const category of ["sans", "serif", "mono"] as const) expect(FONT_CHOICES.some((font) => font.category === category)).toBe(true);
  });

  /**
   * The whole point of a curated list: a generated site must render with no network
   * request at all, so no stack may reach for a hosted font or smuggle CSS syntax in.
   */
  it("resolves only to self-contained stacks with no remote dependency", () => {
    for (const font of FONT_CHOICES) {
      expect(font.stack).not.toMatch(/url\(|@import|@font-face|https?:|fonts\.googleapis|fonts\.gstatic/i);
      expect(font.stack).not.toMatch(/[{};<>]/);
      expect(font.stack.length).toBeLessThanOrEqual(160);
      // Every stack ends in a generic family, so an unavailable face still resolves.
      expect(font.stack).toMatch(/(sans-serif|serif|monospace)$/);
    }
  });

  it("maps an identifier to its stack and falls back rather than emitting anything unvalidated", () => {
    expect(resolveFontStack("georgia")).toBe(findFontChoice("georgia")!.stack);
    expect(resolveFontStack("not-a-font")).toBe(findFontChoice(DEFAULT_BODY_FONT)!.stack);
    expect(findFontChoice("not-a-font")).toBeNull();
  });
});

describe("typography settings validation", () => {
  it("accepts every supported heading and body font", () => {
    for (const font of FONT_CHOICES) {
      expect(themeSettingsSchema.safeParse(themeWith(font.id, font.id)).success).toBe(true);
    }
  });

  it("rejects a font that is not in the catalogue, including raw CSS", () => {
    for (const value of ["Inter", "Comic Sans MS", "arial, sans-serif", "url(https://fonts.googleapis.com/x)", "", "system-sans; color:red"]) {
      expect(fontChoiceSchema.safeParse(value).success, `accepted ${value}`).toBe(false);
      expect(themeSettingsSchema.safeParse(themeWith(value, "arial")).success, `accepted ${value}`).toBe(false);
    }
  });

  it("defaults both faces to the system stacks", () => {
    expect(typographySettingsSchema.parse({})).toEqual({ headingFont: DEFAULT_HEADING_FONT, bodyFont: DEFAULT_BODY_FONT });
    expect(DEFAULT_THEME.typography).toEqual({ headingFont: DEFAULT_HEADING_FONT, bodyFont: DEFAULT_BODY_FONT });
  });
});

describe("legacy theme records", () => {
  it("loads a record written before typography existed, with the look it already had", () => {
    const legacy = { lightTokens: DEFAULT_THEME.lightTokens, darkTokens: DEFAULT_THEME.darkTokens, radiusScale: 34, spacingScale: 66, shadowScale: 28, fontScale: 50, borderScale: 40 };
    const parsed = parseStoredThemeSettings(legacy);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.typography).toEqual({ headingFont: DEFAULT_HEADING_FONT, bodyFont: DEFAULT_BODY_FONT });
    // The system stacks are what those projects were already rendering with.
    expect(parsed.success && resolveProjectDesignTokens(parsed.data).typography.bodyFamily).toBe(findFontChoice(DEFAULT_BODY_FONT)!.stack);
  });

  it("reads flat columns back into the nested domain shape, and writes them back flat", () => {
    const parsed = parseStoredThemeSettings({ ...themeSettingsColumns(themeWith("georgia", "arial")), projectId: "ignored", revision: 4 } as never);
    expect(parsed.success && parsed.data.typography).toEqual({ headingFont: "georgia", bodyFont: "arial" });
    expect(themeSettingsColumns(themeWith("georgia", "arial"))).toMatchObject({ headingFont: "georgia", bodyFont: "arial" });
    expect(themeSettingsColumns(DEFAULT_THEME)).not.toHaveProperty("typography");
  });

  it("refuses a stored font that is not in the catalogue instead of trusting it", () => {
    expect(parseStoredThemeSettings({ ...themeSettingsColumns(DEFAULT_THEME), headingFont: "Times New Roman" } as never).success).toBe(false);
  });
});

describe("resolved typography tokens", () => {
  it("resolves heading and body faces independently of the font scale", () => {
    const resolved = resolveProjectDesignTokens({ ...themeWith("georgia", "arial"), fontScale: 80 });
    expect(resolved.typography.headingFamily).toBe(findFontChoice("georgia")!.stack);
    expect(resolved.typography.bodyFamily).toBe(findFontChoice("arial")!.stack);
    // Size and family are separate decisions and stay separate tokens.
    expect(resolved.typography.multiplier).toBeGreaterThan(resolveProjectDesignTokens(themeWith("georgia", "arial")).typography.multiplier);
  });

  it("publishes semantic font variables to the Canvas preview and the generated runtime", () => {
    const resolved = resolveProjectDesignTokens(themeWith("times-new-roman", "verdana"));
    expect(projectThemeCssVariables(resolved, "light")["--project-font-heading"]).toBe(findFontChoice("times-new-roman")!.stack);
    expect(projectThemeCssVariables(resolved, "dark")["--project-font-body"]).toBe(findFontChoice("verdana")!.stack);
    const declarations = themeScaleDeclarations(resolved);
    expect(declarations).toContain(`--font-heading:${findFontChoice("times-new-roman")!.stack}`);
    expect(declarations).toContain(`--font-body:${findFontChoice("verdana")!.stack}`);
  });
});

describe("generated and exported typography", () => {
  it("applies the project faces semantically, so no page hardcodes a family", () => {
    expect(GENERATED_RUNTIME_CSS).toContain("font-family:var(--font-body)");
    expect(GENERATED_RUNTIME_CSS).toContain(":is(h1,h2,h3,h4,h5,h6){font-family:var(--font-heading)}");
    expect(EXPORT_BASE_CSS).toContain("var(--font-body)");
    expect(EXPORT_BASE_CSS).toContain("h1,h2,h3,h4,h5,h6{font-family:var(--font-heading)}");
  });

  it("keeps an exported site free of any remote font service", () => {
    const stylesheet = `${themeScaleDeclarations(resolveProjectDesignTokens(themeWith("garamond", "tahoma")))}${EXPORT_BASE_CSS}${GENERATED_RUNTIME_CSS}`;
    expect(stylesheet).not.toMatch(/@font-face|@import|fonts\.googleapis|fonts\.gstatic|https?:/i);
    expect(stylesheet).toContain(findFontChoice("garamond")!.stack);
    expect(stylesheet).toContain(findFontChoice("tahoma")!.stack);
  });
});

describe("preset typography", () => {
  it.each(THEME_PRESETS.map((preset) => [preset.id, preset] as const))("%s pairs two catalogued faces", (_id, preset) => {
    expect(findFontChoice(preset.theme.typography.headingFont), preset.theme.typography.headingFont).not.toBeNull();
    expect(findFontChoice(preset.theme.typography.bodyFont), preset.theme.typography.bodyFont).not.toBeNull();
  });

  it("spans more than one typographic character across the set", () => {
    expect(new Set(THEME_PRESETS.map((preset) => `${preset.theme.typography.headingFont}/${preset.theme.typography.bodyFont}`)).size).toBeGreaterThanOrEqual(6);
    expect(THEME_PRESETS.some((preset) => findFontChoice(preset.theme.typography.headingFont)!.category === "serif")).toBe(true);
  });

  /**
   * A preset is a design system. Describing a page shape here is how a theme silently
   * becomes a template, so the descriptions are held to visual character only.
   */
  it("describes visual character rather than page composition", () => {
    for (const preset of THEME_PRESETS) {
      expect(preset.description, preset.id).not.toMatch(/\bhero\b|\bcard grid\b|\bsection\b|\bcolumn\b|\blayout\b|\btemplate\b|\bcall to action\b|\bnavbar\b|\bfooter\b|\bsidebar\b/i);
    }
  });
});
