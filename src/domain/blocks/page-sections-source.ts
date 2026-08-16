import { USAGE_KEY_PATTERN } from "@/domain/generated-source/limits";
import {
  attributeValue,
  parseHtmlFragment,
  serializeHtml,
  walkElements,
  type HtmlElement,
  type HtmlNode,
} from "@/domain/generated-source/html/parser";

/**
 * Editing a page's section list in the page's own markup.
 *
 * A reusable section is present on a page because the page's active document contains an
 * empty `<div data-canvas-block=… data-canvas-usage=…>`. That element is the usage.
 * Nothing else — not the usage row, not the manifest, not the Preview — decides whether
 * the section renders, so "remove this section from the page" has to mean "produce markup
 * without that element", and everything downstream then follows from re-validating it.
 *
 * These functions only ever move whole elements. The rest of the page comes through the
 * parser and the serializer unchanged, and the result still has to pass the ordinary
 * generated-document validator before it can be stored.
 */

export type SectionPlacement =
  | { position: "top" }
  | { position: "bottom" }
  | { position: "before"; anchor: string }
  | { position: "after"; anchor: string };

export class PageSourceEditError extends Error {
  constructor(message: string, readonly reason: "no-root" | "usage-not-found" | "anchor-not-found" | "duplicate-usage" | "invalid-markup") {
    super(message);
    this.name = "PageSourceEditError";
  }
}

function parse(html: string): HtmlNode[] {
  try {
    return parseHtmlFragment(html);
  } catch {
    throw new PageSourceEditError("This page's content could not be read.", "invalid-markup");
  }
}

function isBlockHost(element: HtmlElement) {
  return attributeValue(element, "data-canvas-block") !== null;
}

/** Every `data-canvas-usage` key already used anywhere in this page's markup. */
export function existingUsageKeys(html: string): string[] {
  const keys: string[] = [];
  walkElements(parse(html), (element) => {
    if (!isBlockHost(element)) return;
    const key = attributeValue(element, "data-canvas-usage");
    if (key) keys.push(key);
  });
  return keys;
}

/**
 * A stable, readable usage key derived from a section's name, made unique against the
 * keys already on the page. Keys are part of the document contract, so this produces only
 * values the validator's `USAGE_KEY_PATTERN` accepts.
 */
export function usageKeyFor(name: string, taken: readonly string[]): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "section";
  const safe = USAGE_KEY_PATTERN.test(base) ? base : `section-${base}`.replace(/[^a-z0-9-]/g, "").slice(0, 48);
  const used = new Set(taken);
  if (!used.has(safe)) return safe;
  for (let index = 2; index < 200; index += 1) { const candidate = `${safe}-${index}`; if (!used.has(candidate)) return candidate; }
  throw new PageSourceEditError("This page already has too many copies of that section.", "duplicate-usage");
}

/** The list a node belongs to, and its index in it. */
function locate(nodes: HtmlNode[], predicate: (element: HtmlElement) => boolean): { parent: HtmlNode[]; index: number } | null {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    if (node.type !== "element") continue;
    if (predicate(node)) return { parent: nodes, index };
    const nested = locate(node.children, predicate);
    if (nested) return nested;
  }
  return null;
}

/** True when `element`, or anything inside it, carries the anchor id or usage key. */
function matchesAnchor(element: HtmlElement, anchor: string): boolean {
  let matched = attributeValue(element, "data-canvas-id") === anchor || (isBlockHost(element) && attributeValue(element, "data-canvas-usage") === anchor);
  if (!matched) walkElements(element.children, (child) => {
    if (matched) return;
    if (attributeValue(child, "data-canvas-id") === anchor) matched = true;
    else if (isBlockHost(child) && attributeValue(child, "data-canvas-usage") === anchor) matched = true;
  });
  return matched;
}

function blockHost(blockId: string, usageKey: string): HtmlElement {
  return { type: "element", tag: "div", attributes: [{ name: "data-canvas-block", value: blockId }, { name: "data-canvas-usage", value: usageKey }], children: [] };
}

/** Removes one Building Block host from a page's markup. */
export function removeBlockUsageFromSource(html: string, usageKey: string): string {
  const nodes = parse(html);
  const found = locate(nodes, (element) => isBlockHost(element) && attributeValue(element, "data-canvas-usage") === usageKey);
  if (!found) throw new PageSourceEditError("That section is not on this page.", "usage-not-found");
  found.parent.splice(found.index, 1);
  return serializeHtml(nodes);
}

/**
 * Inserts a Building Block host into a page's markup at a logical position.
 *
 * Placement is expressed in terms of the page's own top-level sections: the top or the
 * bottom of the page, or beside a section the user has selected in the Preview. An anchor
 * is matched by `data-canvas-id` or by an existing usage key; when the anchor is nested
 * inside a section, the whole containing top-level section is what the new one lands
 * beside, because that is what "after this section" means to the person who asked for it.
 */
export function insertBlockUsageIntoSource(html: string, input: { blockId: string; usageKey: string; placement: SectionPlacement }): string {
  const nodes = parse(html);
  const top = nodes.filter((node): node is HtmlElement => node.type === "element");
  if (!top.length) throw new PageSourceEditError("This page has no markup to add a section to.", "no-root");

  // A single wrapper element around the whole page is the usual shape, so sections go
  // inside it rather than as a sibling of it — including when the page is still an empty
  // shell, which is exactly the case where someone adds their first section. A lone
  // Building Block host is not a wrapper: nothing may be nested inside one.
  const container = top.length === 1 && !isBlockHost(top[0]!) ? top[0]!.children : nodes;
  const siblings = container.filter((node): node is HtmlElement => node.type === "element");
  const host = blockHost(input.blockId, input.usageKey);

  if (!siblings.length) { container.push(host); return serializeHtml(nodes); }

  let target: HtmlElement | null = null;
  let after = false;
  if (input.placement.position === "top") target = siblings[0]!;
  else if (input.placement.position === "bottom") { target = siblings[siblings.length - 1]!; after = true; }
  else {
    const anchor = input.placement.anchor;
    target = siblings.find((element) => matchesAnchor(element, anchor)) ?? null;
    if (!target) throw new PageSourceEditError("The section you selected is no longer on this page.", "anchor-not-found");
    after = input.placement.position === "after";
  }

  const index = container.indexOf(target!);
  container.splice(after ? index + 1 : index, 0, host);
  return serializeHtml(nodes);
}
