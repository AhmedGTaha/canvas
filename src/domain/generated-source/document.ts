import { z } from "zod";
import {
  DOCUMENT_DESCRIPTION_MAX_LENGTH,
  DOCUMENT_TITLE_MAX_LENGTH,
  GENERATED_CSS_MAX_BYTES,
  GENERATED_DOCUMENT_MAX_BYTES,
  GENERATED_HTML_MAX_BYTES,
  GENERATED_JS_MAX_BYTES,
} from "./limits";

/**
 * The generated-website data contract.
 *
 * A generated page or Building Block is three separate artifacts plus its metadata, not
 * one blob of source. Keeping them apart is what makes the rest of the system possible:
 * each is validated by the authority for its own language, the Preview can assemble a
 * document without a build step, an export can write `styles/` and `scripts/` files, and
 * a Building Block's CSS and behaviour can be scoped when it is composed onto a page.
 *
 * `html` is a *fragment* — the content of `<body>`, or of one section for a block. It
 * never contains `<html>`, `<head>`, `<style>`, or `<script>`: those belong to whoever
 * assembles the document, which is Canvas, not the model.
 */

export type GeneratedDocumentMetadata = {
  /** `<title>`; falls back to the Page Tree name when the model leaves it empty. */
  title: string | null;
  /** `<meta name="description">`. */
  description: string | null;
};

export type GeneratedDocument = {
  schemaVersion: 1;
  html: string;
  css: string;
  js: string;
  /** Null for Building Blocks: a fragment is not a document and has no page metadata. */
  metadata: GeneratedDocumentMetadata | null;
};

function bytes(value: string) {
  return Buffer.byteLength(value, "utf8");
}

const html = z.string().min(1, "The generated page has no markup.").refine((value) => bytes(value) <= GENERATED_HTML_MAX_BYTES, `HTML exceeds ${GENERATED_HTML_MAX_BYTES} bytes.`);
const css = z.string().default("").refine((value) => bytes(value) <= GENERATED_CSS_MAX_BYTES, `CSS exceeds ${GENERATED_CSS_MAX_BYTES} bytes.`);
const js = z.string().default("").refine((value) => bytes(value) <= GENERATED_JS_MAX_BYTES, `JavaScript exceeds ${GENERATED_JS_MAX_BYTES} bytes.`);

/** Trimmed to null: a model that has nothing to say should not say "". */
const optionalText = (max: number) =>
  z.string().nullish().transform((value) => {
    const trimmed = (value ?? "").replace(/\s+/g, " ").trim();
    return trimmed ? trimmed.slice(0, max) : null;
  });

export const generatedDocumentMetadataSchema = z.object({
  title: optionalText(DOCUMENT_TITLE_MAX_LENGTH),
  description: optionalText(DOCUMENT_DESCRIPTION_MAX_LENGTH),
}).strict();

const withinTotalBudget = <T extends { html: string; css: string; js: string }>(value: T, context: z.RefinementCtx) => {
  if (bytes(value.html) + bytes(value.css) + bytes(value.js) > GENERATED_DOCUMENT_MAX_BYTES) {
    context.addIssue({ code: "custom", message: `The generated document exceeds ${GENERATED_DOCUMENT_MAX_BYTES} bytes.` });
  }
};

/** A page: markup, styles, behaviour, and the metadata for its `<head>`. */
export const generatedPageDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  html,
  css,
  js,
  metadata: generatedDocumentMetadataSchema.nullish().transform((value) => value ?? { title: null, description: null }),
}).strict().superRefine(withinTotalBudget);

/** A Building Block: one reusable fragment, with no page-level metadata of its own. */
export const generatedFragmentDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  html,
  css,
  js,
}).strict().superRefine(withinTotalBudget);

export type GeneratedPageDocumentInput = z.infer<typeof generatedPageDocumentSchema>;
export type GeneratedFragmentDocumentInput = z.infer<typeof generatedFragmentDocumentSchema>;

/**
 * Reads a stored `document` column back into the contract.
 *
 * Storage is the only place a document arrives already validated, so this parse is a
 * shape check rather than a security check — but it still refuses anything that is not
 * the contract, so a hand-edited or partially migrated row surfaces as a specific
 * failure instead of rendering as an empty page.
 */
export const storedDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  html: z.string(),
  css: z.string(),
  js: z.string(),
  metadata: generatedDocumentMetadataSchema.nullable().default(null),
}).strict();

export function readStoredDocument(value: unknown): GeneratedDocument | null {
  const parsed = storedDocumentSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function emptyDocument(): GeneratedDocument {
  return { schemaVersion: 1, html: "", css: "", js: "", metadata: null };
}

export function documentBytes(document: GeneratedDocument) {
  return bytes(document.html) + bytes(document.css) + bytes(document.js);
}
