/** Shared generated-document limits. Safe to import from client components. */

/** Total UTF-8 budget for one generated document (HTML + CSS + JavaScript together). */
export const GENERATED_DOCUMENT_MAX_BYTES = 160_000;
export const GENERATED_HTML_MAX_BYTES = 100_000;
export const GENERATED_CSS_MAX_BYTES = 40_000;
export const GENERATED_JS_MAX_BYTES = 20_000;

export const USAGE_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const BLOCK_MEDIA_ATTACHMENT_LIMIT = 5;

/** Canvas element identifiers used for Preview selection and targeted AI edits. */
export const CANVAS_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const CANVAS_LABEL_MAX_LENGTH = 80;
export const EDITABLE_ELEMENT_LIMIT = 80;

/** Page metadata carried in the generated document itself. */
export const DOCUMENT_TITLE_MAX_LENGTH = 120;
export const DOCUMENT_DESCRIPTION_MAX_LENGTH = 300;

/** Author-defined class names, on top of the shared Canvas runtime classes. */
export const GENERATED_CLASS_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
/** `id` values a generated document may use. Kept prefixable for Building Block scoping. */
export const GENERATED_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
