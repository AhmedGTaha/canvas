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
export const brandSettingsSchema = z.object({
  companyName: z.string().trim().min(1, "Enter a company name.").max(120),
  companyDescription: z.string().trim().max(2000).transform((value) => value || null),
  brandNotes: z.string().trim().max(4000).transform((value) => value || null),
}).strict();
export const updateThemeSchema = z.object({ projectId: projectIdSchema, expectedRevision: z.number().int().positive(), theme: themeSettingsSchema }).strict();
export const updateBrandSchema = z.object({ projectId: projectIdSchema, expectedRevision: z.number().int().positive(), brand: brandSettingsSchema }).strict();
export const resetThemeSchema = z.object({ projectId: projectIdSchema, expectedRevision: z.number().int().positive() }).strict();

export type SemanticColorTokens = z.infer<typeof semanticColorTokensSchema>;
export type ThemeSettingsInput = z.infer<typeof themeSettingsSchema>;
export type BrandSettingsInput = z.infer<typeof brandSettingsSchema>;
