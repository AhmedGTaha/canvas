import { z } from "zod";
import { BLOCK_MEDIA_ATTACHMENT_LIMIT, GENERATED_SOURCE_MAX_BYTES } from "@/domain/generated-source/limits";
import { pageChangeSummarySchema } from "@/domain/page-generation/contract";

export const BLOCK_SOURCE_MAX_BYTES = GENERATED_SOURCE_MAX_BYTES;
export { BLOCK_MEDIA_ATTACHMENT_LIMIT };

export const blockChangeSummarySchema = pageChangeSummarySchema;
export type BlockChangeSummary = z.infer<typeof blockChangeSummarySchema>;

export const generatedBlockResponseSchema = z.object({
  schemaVersion: z.literal(1),
  sourceCode: z.string().min(1).refine((value) => Buffer.byteLength(value, "utf8") <= BLOCK_SOURCE_MAX_BYTES, "Generated block source exceeds 100 KB."),
  referencedMediaIds: z.array(z.uuid()).max(20),
  summary: blockChangeSummarySchema,
}).strict();

export type GeneratedBlockResponse = z.infer<typeof generatedBlockResponseSchema>;

export const generatedBlockResponseJsonSchema = {
  type: "object", additionalProperties: false, required: ["schemaVersion", "sourceCode", "referencedMediaIds", "summary"],
  properties: {
    schemaVersion: { type: "integer", const: 1 }, sourceCode: { type: "string", maxLength: BLOCK_SOURCE_MAX_BYTES },
    referencedMediaIds: { type: "array", maxItems: 20, items: { type: "string", format: "uuid" } },
    summary: { type: "object", additionalProperties: false, required: ["headline", "changes", "limitations"], properties: {
      headline: { type: "string", maxLength: 120 }, changes: { type: "array", maxItems: 6, items: { type: "string", maxLength: 200 } }, limitations: { type: "array", maxItems: 4, items: { type: "string", maxLength: 200 } },
    } },
  },
} as const;
