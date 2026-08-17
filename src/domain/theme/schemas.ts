import { z } from "zod";
import { projectIdSchema } from "@/domain/projects/schemas";
import { DEFAULT_BODY_FONT, DEFAULT_HEADING_FONT, FONT_CHOICE_IDS } from "./fonts";

export const hexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Use a six-digit hex color such as #2563EB.").transform((value) => value.toUpperCase());
export const semanticColorTokensSchema = z.object({
  primary: hexColorSchema,
  secondary: hexColorSchema,
  accent: hexColorSchema,
  background: hexColorSchema,
  surface: hexColorSchema,
  text: hexColorSchema,
  mutedText: hexColorSchema,
  border: hexColorSchema,
}).strict();
export const designScaleSchema = z.number().finite().int().min(0).max(100);
/**
 * A font is chosen by identifier, never by family string, so nothing uncontrolled from a
 * client can end up in a `font-family`. The identifier is mapped to an approved CSS stack
 * at resolve time. Both fields default, so a project theme record written before
 * typography existed still parses and keeps its previous look.
 */
export const fontChoiceSchema = z.enum(FONT_CHOICE_IDS, { message: "Choose one of the available fonts." });
export const typographySettingsSchema = z.object({
  headingFont: fontChoiceSchema.default(DEFAULT_HEADING_FONT),
  bodyFont: fontChoiceSchema.default(DEFAULT_BODY_FONT),
}).strict();
export const themeSettingsSchema = z.object({
  lightTokens: semanticColorTokensSchema,
  darkTokens: semanticColorTokensSchema,
  radiusScale: designScaleSchema,
  spacingScale: designScaleSchema,
  shadowScale: designScaleSchema,
  fontScale: designScaleSchema,
  borderScale: designScaleSchema,
  typography: typographySettingsSchema.default({ headingFont: DEFAULT_HEADING_FONT, bodyFont: DEFAULT_BODY_FONT }),
}).strict();

type StoredThemeSettings = {
  lightTokens?: unknown; darkTokens?: unknown; radiusScale?: unknown; spacingScale?: unknown;
  shadowScale?: unknown; fontScale?: unknown; borderScale?: unknown;
  headingFont?: unknown; bodyFont?: unknown;
};

/**
 * Parse only theme fields from a database record; persistence metadata is not theme input.
 *
 * Typography is stored as two flat columns and read back into the nested shape the domain
 * uses. A record predating those columns supplies neither, and the schema defaults fill in
 * the system stacks the project was already rendering with.
 */
export function parseStoredThemeSettings(record: StoredThemeSettings) {
  return themeSettingsSchema.safeParse({
    lightTokens: record.lightTokens,
    darkTokens: record.darkTokens,
    radiusScale: record.radiusScale,
    spacingScale: record.spacingScale,
    shadowScale: record.shadowScale,
    fontScale: record.fontScale,
    borderScale: record.borderScale,
    typography: {
      ...(record.headingFont === undefined || record.headingFont === null ? {} : { headingFont: record.headingFont }),
      ...(record.bodyFont === undefined || record.bodyFont === null ? {} : { bodyFont: record.bodyFont }),
    },
  });
}

/** Theme input flattened into the columns `project_theme_settings` actually stores. */
export function themeSettingsColumns(theme: ThemeSettingsInput) {
  const { typography, ...scales } = theme;
  return { ...scales, headingFont: typography.headingFont, bodyFont: typography.bodyFont };
}
export const brandSettingsSchema = z.object({
  companyName: z.string().trim().min(1, "Enter a company name.").max(120),
  // Empty is stored and returned as null, so the input side has to accept null
  // too — otherwise reading these settings and saving them straight back fails.
  companyDescription: z.string().trim().max(2000).nullish().transform((value) => value || null),
  brandNotes: z.string().trim().max(4000).nullish().transform((value) => value || null),
}).strict();
export const updateThemeSchema = z.object({ projectId: projectIdSchema, expectedRevision: z.number().int().positive(), theme: themeSettingsSchema }).strict();
export const updateBrandSchema = z.object({ projectId: projectIdSchema, expectedRevision: z.number().int().positive(), brand: brandSettingsSchema }).strict();
export const resetThemeSchema = z.object({ projectId: projectIdSchema, expectedRevision: z.number().int().positive() }).strict();

export type SemanticColorTokens = z.infer<typeof semanticColorTokensSchema>;
export type ThemeSettingsInput = z.infer<typeof themeSettingsSchema>;
export type TypographySettingsInput = z.infer<typeof typographySettingsSchema>;
export type FontChoiceId = z.infer<typeof fontChoiceSchema>;
export type BrandSettingsInput = z.infer<typeof brandSettingsSchema>;
