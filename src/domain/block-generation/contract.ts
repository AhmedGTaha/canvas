import { z } from "zod";
import { changeSummaryProperty, generatedSourceProperty, mediaIdsProperty, schemaVersionProperty, targetCanvasIdProperty, targetRemovedProperty } from "@/domain/generated-source/response-schema";
import { BLOCK_MEDIA_ATTACHMENT_LIMIT, GENERATED_SOURCE_MAX_BYTES } from "@/domain/generated-source/limits";
import { declaredMediaIdsSchema, pageChangeSummarySchema } from "@/domain/page-generation/contract";

export const BLOCK_SOURCE_MAX_BYTES = GENERATED_SOURCE_MAX_BYTES;
export { BLOCK_MEDIA_ATTACHMENT_LIMIT };

export const blockChangeSummarySchema = pageChangeSummarySchema;
export type BlockChangeSummary = z.infer<typeof blockChangeSummarySchema>;

export const generatedBlockResponseSchema = z.object({
  schemaVersion: z.literal(1),
  sourceCode: z.string().min(1).refine((value) => Buffer.byteLength(value, "utf8") <= BLOCK_SOURCE_MAX_BYTES, "Generated block source exceeds 100 KB."),
  referencedMediaIds: declaredMediaIdsSchema,
  targetCanvasId: z.string().max(64).nullish().transform((value) => value ?? null),
  targetRemoved: z.boolean().nullish().transform((value) => value ?? false),
  summary: blockChangeSummarySchema,
}).strict();

export type GeneratedBlockResponse = z.infer<typeof generatedBlockResponseSchema>;

export const generatedBlockResponseJsonSchema = {
  type: "object", additionalProperties: false, required: ["schemaVersion", "sourceCode", "referencedMediaIds", "summary"],
  properties: {
    schemaVersion: schemaVersionProperty,
    sourceCode: generatedSourceProperty,
    referencedMediaIds: mediaIdsProperty,
    targetCanvasId: targetCanvasIdProperty,
    targetRemoved: targetRemovedProperty,
    summary: changeSummaryProperty,
  },
} as const;
