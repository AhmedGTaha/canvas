import { z } from "zod";
import { changeSummaryProperty, generatedSourceProperty, mediaIdsProperty, schemaVersionProperty, targetCanvasIdProperty, targetRemovedProperty } from "@/domain/generated-source/response-schema";

export const PAGE_SOURCE_MAX_BYTES = 102_400;
export const PAGE_MEDIA_ATTACHMENT_LIMIT = 5;

export const SUMMARY_HEADLINE_MAX = 120;
export const SUMMARY_ITEM_MAX = 200;

/**
 * The change summary is display-only prose. Providers routinely overshoot its character
 * limits by a few words while returning otherwise valid source, and `maxLength` is not a
 * keyword Gemini honours, so the limit cannot be enforced at the provider. Clamping here
 * keeps a cosmetic overrun from failing the whole generation job, exactly as
 * `repairGeneratedCanvasIds` absorbs cosmetic ID deviations. The limits themselves stay:
 * `changeSets.summary` is a varchar(300) built from a page name plus this headline.
 */
function clamp(value: string, limit: number) { return value.trim().slice(0, limit).trimEnd(); }

const summaryHeadline = z.string()
  .transform((value) => clamp(value.replace(/\s+/g, " "), SUMMARY_HEADLINE_MAX))
  .pipe(z.string().min(1).max(SUMMARY_HEADLINE_MAX));

// Entries that are blank once trimmed carry no meaning, so they are dropped rather than
// rejected — and dropped before the array limit, which counts real entries only.
const summaryList = (max: number) => z.array(z.string())
  .transform((items) => items.map((item) => clamp(item, SUMMARY_ITEM_MAX)).filter((item) => item.length > 0))
  .pipe(z.array(z.string().min(1).max(SUMMARY_ITEM_MAX)).max(max));

export const pageChangeSummarySchema = z.object({
  headline: summaryHeadline,
  changes: summaryList(6),
  limitations: summaryList(4),
}).strict();

export const PAGE_BLOCK_USAGE_LIMIT = 20;

export const generatedBlockUsageSchema = z.object({
  blockId: z.uuid(),
  usageKey: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "Block usage keys use lowercase letters, numbers, and hyphens."),
}).strict();

export const generatedPageResponseSchema = z.object({
  schemaVersion: z.literal(1),
  sourceCode: z.string().min(1).refine((value) => Buffer.byteLength(value, "utf8") <= PAGE_SOURCE_MAX_BYTES, "Generated page source exceeds 100 KB."),
  referencedMediaIds: z.array(z.uuid()).max(20),
  blockUsages: z.array(generatedBlockUsageSchema).max(PAGE_BLOCK_USAGE_LIMIT).default([]),
  targetCanvasId: z.string().max(64).nullish().transform((value) => value ?? null),
  targetRemoved: z.boolean().nullish().transform((value) => value ?? false),
  summary: pageChangeSummarySchema,
}).strict();

export type GeneratedPageResponse = z.infer<typeof generatedPageResponseSchema>;
export type PageChangeSummary = z.infer<typeof pageChangeSummarySchema>;

export const generatedPageResponseJsonSchema = {
  type: "object", additionalProperties: false, required: ["schemaVersion", "sourceCode", "referencedMediaIds", "summary"],
  properties: {
    schemaVersion: schemaVersionProperty,
    sourceCode: generatedSourceProperty,
    referencedMediaIds: mediaIdsProperty,
    blockUsages: {
      type: "array", maxItems: PAGE_BLOCK_USAGE_LIMIT,
      items: {
        type: "object", additionalProperties: false, required: ["blockId", "usageKey"],
        properties: {
          blockId: { type: "string", description: "A Building Block UUID from existingBuildingBlocks, exactly as supplied." },
          usageKey: { type: "string", description: "Stable lowercase key, unique within this page, using letters, numbers, and hyphens." },
        },
      },
      description: "Every CanvasBlock reference in the source, and nothing else.",
    },
    targetCanvasId: targetCanvasIdProperty,
    targetRemoved: targetRemovedProperty,
    summary: changeSummaryProperty,
  },
} as const;
