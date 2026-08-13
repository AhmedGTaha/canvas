import { z } from "zod";
import { projectIdSchema } from "@/domain/projects/schemas";

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
export const themeSettingsSchema = z.object({
  lightTokens: semanticColorTokensSchema,
  darkTokens: semanticColorTokensSchema,
  radiusScale: designScaleSchema,
  spacingScale: designScaleSchema,
  shadowScale: designScaleSchema,
  fontScale: designScaleSchema,
  borderScale: designScaleSchema,
}).strict();

type StoredThemeSettings = {
  lightTokens?: unknown; darkTokens?: unknown; radiusScale?: unknown; spacingScale?: unknown;
  shadowScale?: unknown; fontScale?: unknown; borderScale?: unknown;
};

/** Parse only theme fields from a database record; persistence metadata is not theme input. */
export function parseStoredThemeSettings(record: StoredThemeSettings) {
  return themeSettingsSchema.safeParse({
    lightTokens: record.lightTokens,
    darkTokens: record.darkTokens,
    radiusScale: record.radiusScale,
    spacingScale: record.spacingScale,
    shadowScale: record.shadowScale,
    fontScale: record.fontScale,
    borderScale: record.borderScale,
  });
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
export type BrandSettingsInput = z.infer<typeof brandSettingsSchema>;
