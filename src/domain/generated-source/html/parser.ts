/**
 * Strict HTML fragment parser and canonical serializer.
 *
 * Generated markup is never handed to a browser as the model wrote it. It is parsed into
 * this tree, checked against the element/attribute policy, and then *re-printed* from the
 * tree. Anything the parser cannot represent — comments, doctypes, processing
 * instructions, raw `<script>` text, mismatched tags, stray `<` — is a parse failure
 * rather than something a browser is left to interpret, so there is no gap between what
 * Canvas validated and what a page actually renders.
 *
 * The parser is deliberately unforgiving. Real HTML parsers recover from malformed input
 * by inventing structure, and that recovery is exactly where sanitizer bypasses live.
 */

export type HtmlAttribute = { name: string; value: string };

export type HtmlElement = {
  type: "element";
  tag: string;
  attributes: HtmlAttribute[];
  children: HtmlNode[];
};
export type HtmlText = { type: "text"; value: string };
export type HtmlNode = HtmlElement | HtmlText;

export class HtmlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HtmlParseError";
  }
}

/** Elements that never have children or a closing tag. */
export const VOID_ELEMENTS: ReadonlySet<string> = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
]);

const TAG_NAME = /^[a-z][a-z0-9]*$/;
const ATTRIBUTE_NAME = /^[a-z][a-z0-9-]*$/;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ",
  copy: "©", reg: "®", trade: "™", hellip: "…",
  mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’",
  ldquo: "“", rdquo: "”", middot: "·", bull: "•",
  times: "×", deg: "°", euro: "€", pound: "£", yen: "¥",
  larr: "←", rarr: "→", uarr: "↑", darr: "↓",
};

/**
 * Decodes the entity subset Canvas understands. An unknown entity is an error rather
 * than a literal: silently passing an obfuscated reference through would mean the
 * validator and the browser disagree about what the markup says.
 */
function decodeEntities(value: string) {
  return value.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);?/gi, (match, body: string) => {
    if (!match.endsWith(";")) throw new HtmlParseError(`unterminated character reference: ${match}`);
    if (body.startsWith("#")) {
      const codePoint = body[1] === "x" || body[1] === "X" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      if (!Number.isInteger(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) throw new HtmlParseError(`invalid character reference: ${match}`);
      // Numeric references are the classic obfuscation vector, so the ones that could
      // re-introduce markup or a control character are rejected outright.
      if (codePoint === 0x3c || codePoint === 0x3e || codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f)) throw new HtmlParseError(`prohibited character reference: ${match}`);
      return String.fromCodePoint(codePoint);
    }
    const replacement = NAMED_ENTITIES[body.toLowerCase()];
    if (replacement === undefined) throw new HtmlParseError(`unsupported character reference: ${match}`);
    return replacement;
  });
}

function assertPlainText(value: string) {
  if (/[<>]/.test(value)) throw new HtmlParseError("stray < or > in text; use &lt; and &gt;");
  if (CONTROL_CHARACTERS.test(value)) throw new HtmlParseError("control character in markup");
  return value;
}

type Parser = { input: string; index: number };

function peek(parser: Parser, offset = 0) {
  return parser.input[parser.index + offset] ?? "";
}

function skipWhitespace(parser: Parser) {
  while (/\s/.test(peek(parser))) parser.index += 1;
}

function readAttributeValue(parser: Parser) {
  const quote = peek(parser);
  if (quote !== "\"" && quote !== "'") throw new HtmlParseError("attribute values must be quoted");
  parser.index += 1;
  const end = parser.input.indexOf(quote, parser.index);
  if (end === -1) throw new HtmlParseError("unterminated attribute value");
  const raw = parser.input.slice(parser.index, end);
  parser.index = end + 1;
  if (raw.includes("<") || raw.includes(">")) throw new HtmlParseError("< or > in attribute value");
  if (CONTROL_CHARACTERS.test(raw)) throw new HtmlParseError("control character in attribute value");
  return decodeEntities(raw);
}

function readTagName(parser: Parser) {
  const start = parser.index;
  while (/[a-zA-Z0-9]/.test(peek(parser))) parser.index += 1;
  const name = parser.input.slice(start, parser.index).toLowerCase();
  if (!TAG_NAME.test(name)) throw new HtmlParseError(`invalid tag name: ${name || "<empty>"}`);
  return name;
}

function readOpeningTag(parser: Parser) {
  const tag = readTagName(parser);
  const attributes: HtmlAttribute[] = [];
  const seen = new Set<string>();
  for (;;) {
    skipWhitespace(parser);
    const character = peek(parser);
    if (character === "") throw new HtmlParseError(`unterminated <${tag}>`);
    if (character === ">") { parser.index += 1; return { tag, attributes, selfClosed: false }; }
    if (character === "/") {
      parser.index += 1;
      if (peek(parser) !== ">") throw new HtmlParseError(`malformed self-closing <${tag}>`);
      parser.index += 1;
      return { tag, attributes, selfClosed: true };
    }
    const start = parser.index;
    while (/[a-zA-Z0-9:_.-]/.test(peek(parser))) parser.index += 1;
    const name = parser.input.slice(start, parser.index).toLowerCase();
    if (!name) throw new HtmlParseError(`malformed attribute in <${tag}>`);
    if (!ATTRIBUTE_NAME.test(name)) throw new HtmlParseError(`invalid attribute name: ${name}`);
    if (seen.has(name)) throw new HtmlParseError(`duplicate attribute: ${name}`);
    seen.add(name);
    skipWhitespace(parser);
    if (peek(parser) === "=") {
      parser.index += 1;
      skipWhitespace(parser);
      attributes.push({ name, value: readAttributeValue(parser) });
    } else {
      // Boolean attribute (hidden, disabled, required, …).
      attributes.push({ name, value: "" });
    }
  }
}

/**
 * Parses one HTML fragment. The result is the list of top-level nodes, which is what a
 * page body or a Building Block fragment is.
 */
export function parseHtmlFragment(input: string): HtmlNode[] {
  const parser: Parser = { input, index: 0 };
  const root: HtmlNode[] = [];
  const stack: HtmlElement[] = [];
  const append = (node: HtmlNode) => { (stack[stack.length - 1]?.children ?? root).push(node); };
  const appendText = (raw: string) => {
    const text = decodeEntities(assertPlainText(raw));
    if (!text.trim()) return;
    // Indentation between tags is layout, not content, so it is collapsed — except
    // inside <pre>, where whitespace is the content.
    const preformatted = stack.some((element) => element.tag === "pre");
    append({ type: "text", value: preformatted ? text : text.replace(/\s+/g, " ") });
  };

  while (parser.index < input.length) {
    const next = input.indexOf("<", parser.index);
    if (next === -1) { appendText(input.slice(parser.index)); break; }
    if (next > parser.index) { appendText(input.slice(parser.index, next)); parser.index = next; }

    parser.index += 1; // consume "<"
    const marker = peek(parser);
    if (marker === "!" || marker === "?") throw new HtmlParseError("comments, doctypes, and processing instructions are not allowed");
    if (marker === "/") {
      parser.index += 1;
      const tag = readTagName(parser);
      skipWhitespace(parser);
      if (peek(parser) !== ">") throw new HtmlParseError(`malformed closing </${tag}>`);
      parser.index += 1;
      const open = stack.pop();
      if (!open) throw new HtmlParseError(`closing </${tag}> with no matching element`);
      if (open.tag !== tag) throw new HtmlParseError(`</${tag}> closes <${open.tag}>`);
      continue;
    }

    const { tag, attributes, selfClosed } = readOpeningTag(parser);
    const element: HtmlElement = { type: "element", tag, attributes, children: [] };
    append(element);
    if (VOID_ELEMENTS.has(tag)) continue;
    if (selfClosed) throw new HtmlParseError(`<${tag}> is not a void element and cannot be self-closed`);
    stack.push(element);
  }

  if (stack.length) throw new HtmlParseError(`unclosed <${stack[stack.length - 1]!.tag}>`);
  return root;
}

export function escapeHtmlText(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function escapeHtmlAttribute(value: string) {
  return escapeHtmlText(value).replace(/"/g, "&quot;");
}

/**
 * Canonical serialization. Every document Canvas stores, previews, or exports is printed
 * from the validated tree by this function, so markup that survives validation is exactly
 * the markup that ships.
 */
export function serializeHtml(nodes: readonly HtmlNode[]): string {
  return nodes.map((node) => {
    if (node.type === "text") return escapeHtmlText(node.value);
    const attributes = node.attributes
      .map((attribute) => (attribute.value === "" ? ` ${attribute.name}` : ` ${attribute.name}="${escapeHtmlAttribute(attribute.value)}"`))
      .join("");
    if (VOID_ELEMENTS.has(node.tag)) return `<${node.tag}${attributes}>`;
    return `<${node.tag}${attributes}>${serializeHtml(node.children)}</${node.tag}>`;
  }).join("");
}

/** Depth-first walk over every element in a fragment. */
export function walkElements(nodes: readonly HtmlNode[], visit: (element: HtmlElement, parent: HtmlElement | null) => void, parent: HtmlElement | null = null) {
  for (const node of nodes) {
    if (node.type !== "element") continue;
    visit(node, parent);
    walkElements(node.children, visit, node);
  }
}

export function attributeValue(element: HtmlElement, name: string) {
  return element.attributes.find((attribute) => attribute.name === name)?.value ?? null;
}

export function setAttribute(element: HtmlElement, name: string, value: string) {
  const existing = element.attributes.find((attribute) => attribute.name === name);
  if (existing) existing.value = value;
  else element.attributes.push({ name, value });
}

export function removeAttribute(element: HtmlElement, name: string) {
  const index = element.attributes.findIndex((attribute) => attribute.name === name);
  if (index !== -1) element.attributes.splice(index, 1);
}

/** Maximum nesting Canvas will accept. Guards the recursive serializer and validator. */
export const HTML_MAX_DEPTH = 40;

export function assertHtmlDepth(nodes: readonly HtmlNode[], depth = 1) {
  if (depth > HTML_MAX_DEPTH) throw new HtmlParseError("markup is nested too deeply");
  for (const node of nodes) if (node.type === "element") assertHtmlDepth(node.children, depth + 1);
}
