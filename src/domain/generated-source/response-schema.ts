import {
  DOCUMENT_DESCRIPTION_MAX_LENGTH,
  DOCUMENT_TITLE_MAX_LENGTH,
  GENERATED_CSS_MAX_BYTES,
  GENERATED_HTML_MAX_BYTES,
  GENERATED_JS_MAX_BYTES,
} from "./limits";

/**
 * JSON Schema fragments for provider structured output.
 *
 * Gemini's `responseJsonSchema` accepts standard JSON Schema but only honours a subset
 * of keywords (`type`, `enum`, `items`, `minItems`/`maxItems`, `properties`, `required`,
 * `additionalProperties`, `anyOf`/`oneOf`, `$ref`/`$defs`, `format`, `title`,
 * `description`). Anything outside that subset — `const`, `nullable`, `maxLength`,
 * exotic `format` values — is expressed as a description instead, so the schema stays
 * portable and the model still gets the constraint.
 *
 * Zod remains the authority: every response is re-validated against the strict contract
 * after parsing, and the deterministic HTML/CSS/JavaScript validators run after that, so
 * a provider ignoring a hint here cannot widen what Canvas accepts.
 */
export const schemaVersionProperty = { type: "integer", enum: [1], description: "Always 1." } as const;

export const htmlProperty = {
  type: "string",
  description: `The body markup as an HTML fragment, at most ${GENERATED_HTML_MAX_BYTES} bytes. No <html>, <head>, <body>, <style>, <script>, <link>, <iframe>, <svg>, or <template> elements; no style attributes; no on* event handler attributes. Images are <img data-canvas-media="<approved Media UUID>" alt="..."> with no src. Reusable sections are <div data-canvas-block="<block UUID>" data-canvas-usage="<stable-key>"></div> and must be empty. Every data-canvas-id is a unique value matching ^[a-z0-9][a-z0-9-]{0,63}$.`,
} as const;

export const cssProperty = {
  type: "string",
  description: `A stylesheet for this document, at most ${GENERATED_CSS_MAX_BYTES} bytes. No @import, no url(), no @font-face, no position:fixed, and no html, body, or :root selectors. Use the project's CSS custom properties for colour, spacing, radius, shadow, and type. May be empty when the Canvas classes are enough.`,
} as const;

export const javascriptProperty = {
  type: "string",
  description: `Optional vanilla JavaScript for this document, at most ${GENERATED_JS_MAX_BYTES} bytes. No imports or exports, no network access, no storage, no cookies, no eval or new Function, no innerHTML or document.write, no window/parent/top/location access, and no references to data-canvas attributes. Use addEventListener, classList, textContent, and attribute toggles such as hidden and aria-expanded. Empty when the document needs no behaviour.`,
} as const;

export const documentMetadataProperty = {
  type: "object",
  additionalProperties: false,
  required: ["title", "description"],
  properties: {
    title: { type: "string", description: `The page title, at most ${DOCUMENT_TITLE_MAX_LENGTH} characters.` },
    description: { type: "string", description: `The meta description, at most ${DOCUMENT_DESCRIPTION_MAX_LENGTH} characters.` },
  },
  description: "SEO metadata for this page.",
} as const;

export const mediaIdsProperty = {
  type: "array",
  maxItems: 20,
  // `format` is supported by Gemini's responseJsonSchema. Keeping it here as well as
  // in Zod prevents the model from treating a descriptive UUID hint as arbitrary text.
  items: { type: "string", format: "uuid", description: "A Media UUID from approvedMedia, exactly as supplied." },
  description: "Every data-canvas-media value used in the html, and nothing else.",
} as const;

export const changeSummaryProperty = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "changes", "limitations"],
  properties: {
    headline: { type: "string", description: "One short sentence, at most 120 characters." },
    changes: { type: "array", maxItems: 6, items: { type: "string", description: "At most 200 characters." } },
    limitations: { type: "array", maxItems: 4, items: { type: "string", description: "At most 200 characters." } },
  },
} as const;

export const targetCanvasIdProperty = {
  type: "string",
  description: "The data-canvas-id of the element that was modified. Omit when no specific element was targeted.",
} as const;

export const targetRemovedProperty = {
  type: "boolean",
  description: "True only when the user asked to remove the selected element. Omit otherwise.",
} as const;
