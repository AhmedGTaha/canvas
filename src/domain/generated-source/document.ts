import { z } from "zod";
import { DOCUMENT_DESCRIPTION_MAX_LENGTH, DOCUMENT_TITLE_MAX_LENGTH } from "./limits";

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
