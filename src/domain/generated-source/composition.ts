import { createHash } from "node:crypto";
import { printCss, scopeCss, validateGeneratedCss } from "./css";
import { wrapGeneratedScript } from "./javascript";
import type { GeneratedDocument } from "./document";
import {
  attributeValue,
  parseHtmlFragment,
  removeAttribute,
  serializeHtml,
  setAttribute,
  walkElements,
  type HtmlElement,
  type HtmlNode,
} from "./html/parser";

/**
 * Composing one page out of its own document and the Building Blocks it references.
 *
 * A page's markup holds an empty `<div data-canvas-block=… data-canvas-usage=…>` where a
 * reusable section goes. This is where that hole is filled, and it is the only place a
 * page's content and a block's content ever meet — which is why the collision problem is
 * solved here rather than being asked of the model:
 *
 * - **CSS** is prefixed with the usage's scope class, so a block's `.card` can only match
 *   inside that block's own host element.
 * - **`@keyframes` names** are prefixed too, so two blocks can both define `fade`.
 * - **`id` attributes** — and every attribute that references one — are prefixed per
 *   usage, so the same block used twice on one page does not produce duplicate ids and a
 *   block's `id="menu"` cannot collide with the page's.
 * - **JavaScript** is wrapped per document, so declarations never collide in the global
 *   scope. Blocks on the same page can still read each other's DOM; they are all the same
 *   person's content on the same page, and the isolation that matters — from Canvas and
 *   from the network — is enforced by the validator and the sandbox, not by scoping.
 */

export type ResolvedMedia = { url: string; width: number; height: number; altText: string | null };
export type MediaResolver = (mediaId: string) => ResolvedMedia | null;

export type ComposedBlockDocument = { blockId: string; usageKey: string; document: GeneratedDocument };

export type CompositionMode = "preview" | "export";

export type ComposeInput = {
  document: GeneratedDocument;
  /** Keyed by `blockId:usageKey`. A usage with no entry renders as nothing. */
  blocks?: Map<string, ComposedBlockDocument>;
  media: MediaResolver;
  mode: CompositionMode;
  /**
   * Export only: maps an internal route to the file that serves it, relative to the page
   * being written. A generated document links to `/about` because that is the project's
   * route; a static folder has to link to the file, so that translation happens here and
   * the stored document keeps its route-shaped links.
   */
  links?: (route: string) => string | null;
};

export type ComposedDocument = { html: string; css: string; js: string; missingMedia: string[]; missingBlocks: string[] };

/** Attributes whose value is an `id`, or a space-separated list of them. */
const ID_REFERENCE_ATTRIBUTES = ["for", "list", "form", "aria-controls", "aria-labelledby", "aria-describedby", "aria-owns", "aria-flowto", "aria-details", "headers"] as const;

/** Editor-only attributes an exported website must never carry. */
const EDITOR_ATTRIBUTES = ["data-canvas-id", "data-canvas-label", "data-canvas-block", "data-canvas-usage", "data-canvas-media"] as const;

export function usageScopeToken(usageKey: string) {
  return `cb-${createHash("sha256").update(usageKey).digest("hex").slice(0, 8)}`;
}

function prefixIds(nodes: HtmlNode[], token: string) {
  const owned = new Set<string>();
  walkElements(nodes, (element) => {
    const id = attributeValue(element, "id");
    if (id) owned.add(id);
  });
  if (!owned.size) return;
  const rename = (value: string) => (owned.has(value) ? `${token}-${value}` : value);
  walkElements(nodes, (element) => {
    const id = attributeValue(element, "id");
    if (id) setAttribute(element, "id", rename(id));
    for (const name of ID_REFERENCE_ATTRIBUTES) {
      const value = attributeValue(element, name);
      if (value === null) continue;
      setAttribute(element, name, value.split(/\s+/).filter(Boolean).map(rename).join(" "));
    }
    if (element.tag === "a") {
      const href = attributeValue(element, "href");
      if (href && href.startsWith("#")) setAttribute(element, "href", `#${rename(href.slice(1))}`);
    }
  });
}

function applyMedia(nodes: HtmlNode[], media: MediaResolver, missing: Set<string>) {
  walkElements(nodes, (element) => {
    if (element.tag !== "img") return;
    const mediaId = attributeValue(element, "data-canvas-media");
    if (!mediaId) return;
    const asset = media(mediaId);
    if (!asset) { missing.add(mediaId); return; }
    setAttribute(element, "src", asset.url);
    if (attributeValue(element, "width") === null) setAttribute(element, "width", String(asset.width));
    if (attributeValue(element, "height") === null) setAttribute(element, "height", String(asset.height));
    if (!attributeValue(element, "alt")) setAttribute(element, "alt", asset.altText ?? "");
    setAttribute(element, "loading", "lazy");
    setAttribute(element, "decoding", "async");
    const className = attributeValue(element, "class");
    setAttribute(element, "class", className ? `canvas-image ${className}` : "canvas-image");
    removeAttribute(element, "data-canvas-media");
  });
}

function applyLinks(nodes: HtmlNode[], links: (route: string) => string | null) {
  walkElements(nodes, (element) => {
    if (element.tag !== "a") return;
    const href = attributeValue(element, "href");
    if (!href || !href.startsWith("/")) return;
    const [path, rest] = [href.split(/[?#]/)[0] || "/", href.slice((href.split(/[?#]/)[0] || "/").length)];
    const target = links(path);
    if (target) setAttribute(element, "href", `${target}${rest}`);
  });
}

function stripEditorAttributes(nodes: HtmlNode[]) {
  walkElements(nodes, (element) => {
    for (const name of EDITOR_ATTRIBUTES) removeAttribute(element, name);
  });
}

/**
 * A stored document's CSS is re-parsed here rather than trusted as text, because scoping
 * needs the rule tree anyway and a row that was hand-edited in the database should fail
 * the same way a bad generation does.
 */
function stylesheetOf(document: GeneratedDocument, scope: { selector: string; prefix: string } | null) {
  if (!document.css.trim()) return "";
  const { rules } = validateGeneratedCss(document.css);
  return scope ? printCss(scopeCss(rules, scope.selector, `${scope.prefix}-`)) : printCss(rules);
}

/** Assembles one page: markup, one stylesheet, one script. */
export function composeDocument(input: ComposeInput): ComposedDocument {
  const nodes = parseHtmlFragment(input.document.html);
  const missingMedia = new Set<string>();
  const missingBlocks: string[] = [];
  const stylesheets: string[] = [];
  const scripts: string[] = [];

  const hosts: HtmlElement[] = [];
  walkElements(nodes, (element) => {
    if (attributeValue(element, "data-canvas-block")) hosts.push(element);
  });

  for (const host of hosts) {
    const blockId = attributeValue(host, "data-canvas-block")!;
    const usageKey = attributeValue(host, "data-canvas-usage") ?? "";
    const resolved = input.blocks?.get(`${blockId}:${usageKey}`);
    if (!resolved) { missingBlocks.push(`${blockId}:${usageKey}`); continue; }
    // The scope lives in a class rather than a data attribute: an exported website has
    // every `data-canvas-*` attribute stripped, and the block's stylesheet has to keep
    // matching after that.
    const token = usageScopeToken(usageKey);
    const className = attributeValue(host, "class");
    setAttribute(host, "class", [`canvas-block-host`, token, className].filter(Boolean).join(" "));

    const blockNodes = parseHtmlFragment(resolved.document.html);
    prefixIds(blockNodes, token);
    applyMedia(blockNodes, input.media, missingMedia);
    host.children = blockNodes;

    const blockCss = stylesheetOf(resolved.document, { selector: `.${token}`, prefix: token });
    if (blockCss) stylesheets.push(blockCss);
    const blockJs = wrapGeneratedScript(resolved.document.js);
    if (blockJs) scripts.push(blockJs);
  }

  applyMedia(nodes, input.media, missingMedia);
  const pageCss = stylesheetOf(input.document, null);
  if (pageCss) stylesheets.unshift(pageCss);
  const pageJs = wrapGeneratedScript(input.document.js);
  if (pageJs) scripts.unshift(pageJs);

  if (input.links) applyLinks(nodes, input.links);
  if (input.mode === "export") stripEditorAttributes(nodes);

  return {
    html: serializeHtml(nodes),
    css: stylesheets.join("\n"),
    js: scripts.join("\n"),
    missingMedia: [...missingMedia],
    missingBlocks,
  };
}

/** Composes a Building Block on its own, for the standalone block Preview. */
export function composeFragment(input: { document: GeneratedDocument; media: MediaResolver; mode: CompositionMode }): ComposedDocument {
  const nodes = parseHtmlFragment(input.document.html);
  const missingMedia = new Set<string>();
  applyMedia(nodes, input.media, missingMedia);
  if (input.mode === "export") stripEditorAttributes(nodes);
  return {
    html: serializeHtml(nodes),
    css: stylesheetOf(input.document, null),
    js: wrapGeneratedScript(input.document.js),
    missingMedia: [...missingMedia],
    missingBlocks: [],
  };
}
