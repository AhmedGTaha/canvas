import { z } from "zod";
import { changeSummaryProperty, generatedSourceProperty, mediaIdsProperty, schemaVersionProperty, targetCanvasIdProperty, targetRemovedProperty } from "@/domain/generated-source/response-schema";

export const PAGE_SOURCE_MAX_BYTES = 102_400;
export const PAGE_MEDIA_ATTACHMENT_LIMIT = 5;

export const pageChangeSummarySchema = z.object({
  headline: z.string().trim().min(1).max(120),
  changes: z.array(z.string().trim().min(1).max(200)).max(6),
  limitations: z.array(z.string().trim().min(1).max(200)).max(4),
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
