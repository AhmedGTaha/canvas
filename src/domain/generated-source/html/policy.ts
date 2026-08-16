/**
 * The element and attribute vocabulary a generated website may use.
 *
 * This is an allowlist, not a blocklist: an element or attribute that is not named here
 * is rejected, so a construct nobody considered cannot arrive by default. The list covers
 * document structure, text, tables, and forms — everything a marketing or content website
 * needs — and deliberately excludes every element that can load or execute code
 * (`script`, `iframe`, `object`, `embed`, `link`, `style`, `meta`, `base`, `svg`,
 * `math`, `template`, `audio`, `video`).
 */

/** Attributes allowed on every permitted element. */
export const GLOBAL_ATTRIBUTES: ReadonlySet<string> = new Set([
  "id", "class", "title", "lang", "dir", "role", "hidden", "tabindex",
  "data-canvas-id", "data-canvas-label", "data-canvas-block", "data-canvas-usage", "data-canvas-media",
]);

/** Element-specific attributes, on top of the global set. */
export const ELEMENT_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
  a: ["href", "target", "rel", "download"],
  img: ["alt", "width", "height", "loading", "decoding", "sizes"],
  time: ["datetime"],
  q: ["cite"],
  blockquote: ["cite"],
  ol: ["start", "reversed", "type"],
  li: ["value"],
  details: ["open"],
  form: ["novalidate", "autocomplete"],
  label: ["for"],
  input: ["type", "name", "value", "placeholder", "required", "disabled", "readonly", "checked", "min", "max", "step", "minlength", "maxlength", "pattern", "autocomplete", "inputmode", "multiple", "accept", "list"],
  textarea: ["name", "placeholder", "required", "disabled", "readonly", "rows", "cols", "minlength", "maxlength", "autocomplete", "wrap"],
  select: ["name", "required", "disabled", "multiple", "size", "autocomplete"],
  option: ["value", "selected", "disabled", "label"],
  optgroup: ["label", "disabled"],
  button: ["type", "name", "value", "disabled"],
  fieldset: ["disabled", "name"],
  output: ["for", "name"],
  progress: ["value", "max"],
  meter: ["value", "min", "max", "low", "high", "optimum"],
  th: ["colspan", "rowspan", "scope", "headers", "abbr"],
  td: ["colspan", "rowspan", "headers"],
  col: ["span"],
  colgroup: ["span"],
  datalist: [],
};

/** Every element a generated document may contain. */
export const ALLOWED_ELEMENTS: ReadonlySet<string> = new Set([
  // Sectioning and grouping
  "div", "section", "article", "aside", "header", "footer", "main", "nav",
  "figure", "figcaption", "hgroup", "search",
  // Text
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "span", "strong", "em", "b", "i", "u", "s",
  "small", "mark", "sub", "sup", "abbr", "cite", "q", "blockquote", "code", "pre", "kbd",
  "samp", "var", "time", "address", "br", "hr", "wbr", "data",
  // Lists
  "ul", "ol", "li", "dl", "dt", "dd",
  // Links and media
  "a", "img", "picture",
  // Tables
  "table", "caption", "colgroup", "col", "thead", "tbody", "tfoot", "tr", "th", "td",
  // Forms and interactive
  "form", "label", "input", "textarea", "select", "option", "optgroup", "button",
  "fieldset", "legend", "output", "progress", "meter", "datalist",
  "details", "summary",
]);

/**
 * Elements that are explicitly named in a diagnostic when a model reaches for them. They
 * are rejected either way; naming them turns "unsupported element" into a message a
 * person can act on and a repair pass can fix.
 */
export const FORBIDDEN_ELEMENTS: ReadonlySet<string> = new Set([
  "script", "style", "link", "meta", "base", "iframe", "frame", "frameset", "object",
  "embed", "applet", "svg", "math", "template", "slot", "canvas", "audio", "video",
  "source", "track", "portal", "dialog", "noscript", "html", "head", "body", "title",
]);

/** Values `<a target>` may take. `_parent`/`_top` would reach outside the sandbox. */
export const ALLOWED_LINK_TARGETS: ReadonlySet<string> = new Set(["_self", "_blank"]);

export const ALLOWED_INPUT_TYPES: ReadonlySet<string> = new Set([
  "text", "email", "tel", "url", "number", "search", "password", "date", "time",
  "datetime-local", "month", "week", "checkbox", "radio", "range", "color", "hidden",
  "submit", "reset", "button",
]);

/** Link schemes a generated document may point at. */
export const ALLOWED_LINK_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:", "mailto:", "tel:"]);

/**
 * `aria-*` is allowed as a family because it is large, purely descriptive, and cannot
 * carry behaviour. `on*` is not an attribute family here at all: inline event handlers
 * are how markup executes code, and generated behaviour belongs in the validated
 * JavaScript file instead.
 */
export function isAllowedAriaAttribute(name: string) {
  return /^aria-[a-z]+(?:-[a-z]+)*$/.test(name);
}

/**
 * Non-Canvas `data-*` attributes are allowed so generated JavaScript has somewhere to
 * keep its own state, but the `data-canvas-*` namespace belongs to Canvas: only the exact
 * names in `GLOBAL_ATTRIBUTES` are accepted, so generated markup cannot invent a Canvas
 * attribute Canvas would later trust.
 */
export function isAllowedDataAttribute(name: string) {
  if (!/^data-[a-z][a-z0-9-]*$/.test(name)) return false;
  return !name.startsWith("data-canvas");
}

export function isAllowedAttribute(tag: string, name: string) {
  if (name.startsWith("on")) return false;
  if (GLOBAL_ATTRIBUTES.has(name)) return true;
  if (isAllowedAriaAttribute(name)) return true;
  if (isAllowedDataAttribute(name)) return true;
  return (ELEMENT_ATTRIBUTES[tag] ?? []).includes(name);
}
