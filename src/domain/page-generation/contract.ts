import { z } from "zod";
import {
  changeSummaryProperty,
  cssProperty,
  documentMetadataProperty,
  htmlProperty,
  javascriptProperty,
  mediaIdsProperty,
  schemaVersionProperty,
  targetCanvasIdProperty,
  targetRemovedProperty,
} from "@/domain/generated-source/response-schema";
import { generatedDocumentMetadataSchema } from "@/domain/generated-source/document";
import { GENERATED_CSS_MAX_BYTES, GENERATED_DOCUMENT_MAX_BYTES, GENERATED_HTML_MAX_BYTES, GENERATED_JS_MAX_BYTES } from "@/domain/generated-source/limits";

export const PAGE_MEDIA_ATTACHMENT_LIMIT = 5;

export const SUMMARY_HEADLINE_MAX = 120;
export const SUMMARY_ITEM_MAX = 200;

/**
 * The change summary is display-only prose. Providers routinely overshoot its character
 * limits by a few words while returning an otherwise valid document, and `maxLength` is
 * not a keyword Gemini honours, so the limit cannot be enforced at the provider. Clamping
 * here keeps a cosmetic overrun from failing the whole generation job, exactly as
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

export const MEDIA_REFERENCE_LIMIT = 20;

/**
 * Gemini does not enforce `format: "uuid"` inside `responseJsonSchema`, so a model that
 * declares one invented reference alongside real ones (a filename, a placeholder) fails
 * the whole job at the schema stage, before the document validator — the real authority
 * on Media references — ever runs. A non-UUID entry cannot name an approved Media asset,
 * so it carries no meaning and is dropped, exactly as over-length summary prose is
 * clamped. Nothing is widened: `validateGeneratedDocument` still derives the manifest
 * from the markup, rejects any media reference that is not approved, and still fails a
 * declaration that disagrees with the document.
 */
export const declaredMediaIdsSchema = z.array(z.string())
  .transform((ids) => ids.filter((id) => z.uuid().safeParse(id).success))
  .pipe(z.array(z.uuid()).max(MEDIA_REFERENCE_LIMIT));

export const PAGE_BLOCK_USAGE_LIMIT = 20;

export const generatedBlockUsageSchema = z.object({
  blockId: z.uuid(),
  usageKey: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "Block usage keys use lowercase letters, numbers, and hyphens."),
}).strict();

const byteLimited = (limit: number, label: string) =>
  z.string().refine((value) => Buffer.byteLength(value, "utf8") <= limit, `Generated ${label} exceeds ${limit} bytes.`);

/**
 * One generated page as the provider returns it: markup, styles, behaviour, page
 * metadata, and the declarations Canvas cross-checks the document against.
 */
export const generatedPageResponseSchema = z.object({
  schemaVersion: z.literal(1),
  html: byteLimited(GENERATED_HTML_MAX_BYTES, "HTML").pipe(z.string().min(1)),
  css: byteLimited(GENERATED_CSS_MAX_BYTES, "CSS").nullish().transform((value) => value ?? ""),
  js: byteLimited(GENERATED_JS_MAX_BYTES, "JavaScript").nullish().transform((value) => value ?? ""),
  metadata: generatedDocumentMetadataSchema.nullish().transform((value) => value ?? { title: null, description: null }),
  referencedMediaIds: declaredMediaIdsSchema,
  blockUsages: z.array(generatedBlockUsageSchema).max(PAGE_BLOCK_USAGE_LIMIT).default([]),
  targetCanvasId: z.string().max(64).nullish().transform((value) => value ?? null),
  targetRemoved: z.boolean().nullish().transform((value) => value ?? false),
  summary: pageChangeSummarySchema,
}).strict().superRefine((value, context) => {
  const total = Buffer.byteLength(value.html, "utf8") + Buffer.byteLength(value.css, "utf8") + Buffer.byteLength(value.js, "utf8");
  if (total > GENERATED_DOCUMENT_MAX_BYTES) context.addIssue({ code: "custom", message: `The generated document exceeds ${GENERATED_DOCUMENT_MAX_BYTES} bytes.` });
});

export type GeneratedPageResponse = z.infer<typeof generatedPageResponseSchema>;
export type PageChangeSummary = z.infer<typeof pageChangeSummarySchema>;

export const generatedPageResponseJsonSchema = {
  type: "object", additionalProperties: false, required: ["schemaVersion", "html", "css", "js", "metadata", "referencedMediaIds", "summary"],
  properties: {
    schemaVersion: schemaVersionProperty,
    html: htmlProperty,
    css: cssProperty,
    js: javascriptProperty,
    metadata: documentMetadataProperty,
    referencedMediaIds: mediaIdsProperty,
    blockUsages: {
      type: "array", maxItems: PAGE_BLOCK_USAGE_LIMIT,
      items: {
        type: "object", additionalProperties: false, required: ["blockId", "usageKey"],
        properties: {
          blockId: { type: "string", format: "uuid", description: "A Building Block UUID from existingBuildingBlocks, exactly as supplied." },
          usageKey: { type: "string", description: "Stable lowercase key, unique within this page, using letters, numbers, and hyphens." },
        },
      },
      description: "Every data-canvas-block reference in the html, and nothing else.",
    },
    targetCanvasId: targetCanvasIdProperty,
    targetRemoved: targetRemovedProperty,
    summary: changeSummaryProperty,
  },
} as const;

/** The document half of a page response, ready for the deterministic validator. */
export function pageDocumentFrom(response: GeneratedPageResponse) {
  return { schemaVersion: 1 as const, html: response.html, css: response.css, js: response.js, metadata: response.metadata };
}
