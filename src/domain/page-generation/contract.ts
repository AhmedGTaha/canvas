import { z } from "zod";

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
  summary: pageChangeSummarySchema,
}).strict();

export type GeneratedPageResponse = z.infer<typeof generatedPageResponseSchema>;
export type PageChangeSummary = z.infer<typeof pageChangeSummarySchema>;

export const generatedPageResponseJsonSchema = {
  type: "object", additionalProperties: false, required: ["schemaVersion", "sourceCode", "referencedMediaIds", "summary"],
  properties: {
    schemaVersion: { type: "integer", const: 1 }, sourceCode: { type: "string", maxLength: PAGE_SOURCE_MAX_BYTES },
    referencedMediaIds: { type: "array", maxItems: 20, items: { type: "string", format: "uuid" } },
    blockUsages: { type: "array", maxItems: PAGE_BLOCK_USAGE_LIMIT, items: { type: "object", additionalProperties: false, required: ["blockId", "usageKey"], properties: { blockId: { type: "string", format: "uuid" }, usageKey: { type: "string", maxLength: 64 } } } },
    summary: { type: "object", additionalProperties: false, required: ["headline", "changes", "limitations"], properties: {
      headline: { type: "string", maxLength: 120 }, changes: { type: "array", maxItems: 6, items: { type: "string", maxLength: 200 } }, limitations: { type: "array", maxItems: 4, items: { type: "string", maxLength: 200 } },
    } },
  },
} as const;

