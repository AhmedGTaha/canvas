import { z } from "zod";
import {
  changeSummaryProperty,
  cssProperty,
  htmlProperty,
  javascriptProperty,
  mediaIdsProperty,
  schemaVersionProperty,
  targetCanvasIdProperty,
  targetRemovedProperty,
} from "@/domain/generated-source/response-schema";
import { BLOCK_MEDIA_ATTACHMENT_LIMIT, GENERATED_CSS_MAX_BYTES, GENERATED_DOCUMENT_MAX_BYTES, GENERATED_HTML_MAX_BYTES, GENERATED_JS_MAX_BYTES } from "@/domain/generated-source/limits";
import { declaredMediaIdsSchema, pageChangeSummarySchema } from "@/domain/page-generation/contract";

export { BLOCK_MEDIA_ATTACHMENT_LIMIT };

export const blockChangeSummarySchema = pageChangeSummarySchema;
export type BlockChangeSummary = z.infer<typeof blockChangeSummarySchema>;

const byteLimited = (limit: number, label: string) =>
  z.string().refine((value) => Buffer.byteLength(value, "utf8") <= limit, `Generated ${label} exceeds ${limit} bytes.`);

/**
 * A Building Block is a fragment, not a page: it carries markup, its own styles, and its
 * own behaviour, but no page metadata, because it is composed into pages that have their
 * own titles and descriptions.
 */
export const generatedBlockResponseSchema = z.object({
  schemaVersion: z.literal(1),
  html: byteLimited(GENERATED_HTML_MAX_BYTES, "HTML").pipe(z.string().min(1)),
  css: byteLimited(GENERATED_CSS_MAX_BYTES, "CSS").nullish().transform((value) => value ?? ""),
  js: byteLimited(GENERATED_JS_MAX_BYTES, "JavaScript").nullish().transform((value) => value ?? ""),
  referencedMediaIds: declaredMediaIdsSchema,
  targetCanvasId: z.string().max(64).nullish().transform((value) => value ?? null),
  targetRemoved: z.boolean().nullish().transform((value) => value ?? false),
  summary: blockChangeSummarySchema,
}).strict().superRefine((value, context) => {
  const total = Buffer.byteLength(value.html, "utf8") + Buffer.byteLength(value.css, "utf8") + Buffer.byteLength(value.js, "utf8");
  if (total > GENERATED_DOCUMENT_MAX_BYTES) context.addIssue({ code: "custom", message: `The generated document exceeds ${GENERATED_DOCUMENT_MAX_BYTES} bytes.` });
});

export type GeneratedBlockResponse = z.infer<typeof generatedBlockResponseSchema>;

export const generatedBlockResponseJsonSchema = {
  type: "object", additionalProperties: false, required: ["schemaVersion", "html", "css", "js", "referencedMediaIds", "summary"],
  properties: {
    schemaVersion: schemaVersionProperty,
    html: htmlProperty,
    css: cssProperty,
    js: javascriptProperty,
    referencedMediaIds: mediaIdsProperty,
    targetCanvasId: targetCanvasIdProperty,
    targetRemoved: targetRemovedProperty,
    summary: changeSummaryProperty,
  },
} as const;

/** The document half of a block response, ready for the deterministic validator. */
export function blockDocumentFrom(response: GeneratedBlockResponse) {
  return { schemaVersion: 1 as const, html: response.html, css: response.css, js: response.js, metadata: null };
}
