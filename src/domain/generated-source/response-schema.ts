import { GENERATED_SOURCE_MAX_BYTES } from "./limits";

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
 * after parsing, so a provider ignoring a hint here cannot widen what Canvas accepts.
 */
export const schemaVersionProperty = { type: "integer", enum: [1], description: "Always 1." } as const;

export const generatedSourceProperty = {
  type: "string",
  description: `Complete TSX source for one default-exported component, at most ${GENERATED_SOURCE_MAX_BYTES} bytes.`,
} as const;

export const mediaIdsProperty = {
  type: "array",
  maxItems: 20,
  items: { type: "string", description: "A Media UUID from approvedMedia, exactly as supplied." },
  description: "Every CanvasImage mediaId used in the source, and nothing else.",
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
