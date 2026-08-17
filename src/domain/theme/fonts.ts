/**
 * The project typography vocabulary.
 *
 * A project stores a font *identifier*, never a font family string. The identifier is
 * validated against this list and only ever mapped to a stack here, so no client, no
 * project record, and no model response can put arbitrary CSS into the `font-family`
 * of a generated site.
 *
 * Every stack is composed of fonts that are already present on the device or fall back
 * to a platform default. Nothing here requires a network request, which is what keeps a
 * generated site self-contained: generated CSS may not use `@font-face` or `url()`, and
 * an exported site must render identically with no remote host reachable.
 *
 * The shape is deliberately indirection-friendly: adding managed or bundled custom fonts
 * later means adding entries (and a `source` of something other than "system") without
 * changing the theme schema, the resolver, the runtime, or the export.
 */
export type FontCategory = "sans" | "serif" | "mono";

export type FontChoice = {
  id: string;
  /** What the picker shows. Human wording, not a CSS family. */
  label: string;
  category: FontCategory;
  /** The full CSS stack this identifier resolves to. */
  stack: string;
};

export const FONT_CHOICES: readonly FontChoice[] = Object.freeze([
  { id: "system-sans", label: "System sans", category: "sans", stack: `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif` },
  { id: "arial", label: "Arial", category: "sans", stack: `Arial, "Helvetica Neue", Helvetica, sans-serif` },
  { id: "helvetica", label: "Helvetica", category: "sans", stack: `"Helvetica Neue", Helvetica, Arial, sans-serif` },
  { id: "verdana", label: "Verdana", category: "sans", stack: `Verdana, Geneva, sans-serif` },
  { id: "tahoma", label: "Tahoma", category: "sans", stack: `Tahoma, Verdana, Geneva, sans-serif` },
  { id: "trebuchet-ms", label: "Trebuchet MS", category: "sans", stack: `"Trebuchet MS", "Lucida Grande", "Lucida Sans Unicode", sans-serif` },
  { id: "system-serif", label: "System serif", category: "serif", stack: `ui-serif, Georgia, Cambria, "Times New Roman", Times, serif` },
  { id: "georgia", label: "Georgia", category: "serif", stack: `Georgia, "Times New Roman", Times, serif` },
  { id: "times-new-roman", label: "Times New Roman", category: "serif", stack: `"Times New Roman", Times, Georgia, serif` },
  { id: "garamond", label: "Garamond", category: "serif", stack: `Garamond, "Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif` },
  { id: "courier-new", label: "Courier New", category: "mono", stack: `"Courier New", Courier, monospace` },
  { id: "system-mono", label: "System monospace", category: "mono", stack: `ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace` },
]);

export const FONT_CHOICE_IDS = FONT_CHOICES.map((font) => font.id) as [string, ...string[]];

const BY_ID = new Map(FONT_CHOICES.map((font) => [font.id, font]));

export const DEFAULT_HEADING_FONT = "system-sans";
export const DEFAULT_BODY_FONT = "system-sans";

export function findFontChoice(id: string): FontChoice | null {
  return BY_ID.get(id) ?? null;
}

/**
 * The CSS stack for a stored identifier. Unknown identifiers cannot reach here through
 * validated input, so an unrecognised one is a data fault rather than a user choice: it
 * falls back to the system stack instead of emitting anything unvalidated.
 */
export function resolveFontStack(id: string, fallback: string = DEFAULT_BODY_FONT): string {
  return (BY_ID.get(id) ?? BY_ID.get(fallback) ?? FONT_CHOICES[0]!).stack;
}

/** The picker groups by category, because "Arial or Georgia" is the real decision. */
export const FONT_CATEGORY_LABELS: Record<FontCategory, string> = { sans: "Sans-serif", serif: "Serif", mono: "Monospace" };
