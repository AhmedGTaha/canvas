import { z } from "zod";

const hex = z.string().regex(/^#[0-9A-F]{6}$/); const cssValue = z.string().max(160).refine((value) => !/[{};<>]/.test(value));
const colors = z.object({ primary: hex, secondary: hex, accent: hex, background: hex, surface: hex, text: hex, mutedText: hex, border: hex }).strict();
const resolvedTokens = z.object({
  colors: z.object({ light: colors, dark: colors }).strict(),
  radius: z.object({ sm: cssValue, md: cssValue, lg: cssValue, xl: cssValue }).strict(),
  spacing: z.object({ multiplier: z.number(), xs: cssValue, sm: cssValue, md: cssValue, lg: cssValue, xl: cssValue }).strict(),
  shadows: z.object({ sm: cssValue, md: cssValue, lg: cssValue }).strict(),
  typography: z.object({ multiplier: z.number(), body: cssValue, heading: cssValue }).strict(),
  borders: z.object({ width: cssValue, strongWidth: cssValue }).strict(),
}).strict();
const page = z.object({ pageId: z.uuid(), parentId: z.uuid().nullable(), name: z.string(), canonicalRoute: z.string().startsWith("/"), isHomepage: z.boolean(), currentVersionId: z.uuid().nullable().default(null), contentStatus: z.enum(["unbuilt", "generated"]).default("unbuilt"), seo: z.object({ title: z.string().nullable(), description: z.string().nullable() }).strict() }).strict();
export type PreviewNavigationItem = { type: "page"; id: string; label: string; route: string; children: PreviewNavigationItem[] } | { type: "group"; id: string; label: string; children: PreviewNavigationItem[] };
const navigationItem: z.ZodType<PreviewNavigationItem> = z.lazy(() => z.discriminatedUnion("type", [
  z.object({ type: z.literal("page"), id: z.uuid(), label: z.string(), route: z.string().startsWith("/"), children: z.array(navigationItem) }).strict(),
  z.object({ type: z.literal("group"), id: z.uuid(), label: z.string(), children: z.array(navigationItem) }).strict(),
]));

export const projectPreviewManifestSchema = z.object({
  manifestVersion: z.literal(1), projectId: z.uuid(), previewSessionId: z.string(), generatedAt: z.iso.datetime(), previewRevision: z.string(), homepage: z.uuid().nullable(),
  routes: z.record(z.string().startsWith("/"), z.object({ pageId: z.uuid(), name: z.string() }).strict()), pages: z.array(page),
  brand: z.object({ companyName: z.string(), companyDescription: z.string().nullable(), primaryLogoMediaId: z.uuid().nullable(), alternateLogoMediaId: z.uuid().nullable(), logoMediaIds: z.object({ light: z.uuid().nullable(), dark: z.uuid().nullable() }).strict() }).strict(),
  theme: resolvedTokens,
  media: z.record(z.uuid(), z.object({ id: z.uuid(), displayName: z.string(), mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]), width: z.number().int().positive(), height: z.number().int().positive(), altText: z.string().nullable(), previewUrl: z.string().startsWith("/api/preview/media/") }).strict()),
  navigation: z.array(navigationItem),
}).strict();

export type ProjectPreviewManifest = z.infer<typeof projectPreviewManifestSchema>;
