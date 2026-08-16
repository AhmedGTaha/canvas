import { createHash } from "node:crypto";
import { AIError } from "@/domain/ai/provider";
import { CssValidationError, validateGeneratedCss } from "./css";
import { JavaScriptValidationError, validateGeneratedJavaScript } from "./javascript";
import {
  attributeValue,
  HtmlParseError,
  parseHtmlFragment,
  serializeHtml,
  walkElements,
  assertHtmlDepth,
  type HtmlElement,
  type HtmlNode,
} from "./html/parser";
import {
  ALLOWED_INPUT_TYPES,
  ALLOWED_LINK_PROTOCOLS,
  ALLOWED_LINK_TARGETS,
  ALLOWED_ELEMENTS,
  FORBIDDEN_ELEMENTS,
  isAllowedAttribute,
} from "./html/policy";
import {
  CANVAS_ID_PATTERN,
  CANVAS_LABEL_MAX_LENGTH,
  EDITABLE_ELEMENT_LIMIT,
  GENERATED_CLASS_PATTERN,
  GENERATED_DOCUMENT_MAX_BYTES,
  GENERATED_ID_PATTERN,
  USAGE_KEY_PATTERN,
} from "./limits";
import type { EditableElement } from "./selection";
import { generatedDocumentValidationMessage } from "./diagnostics";
import { emptyDocument, type GeneratedDocument } from "./document";

export { GENERATED_DOCUMENT_MAX_BYTES, USAGE_KEY_PATTERN };

export type GeneratedBlockUsage = { blockId: string; usageKey: string };

/**
 * What Canvas derives from a validated document and stores alongside it. The shape is
 * unchanged from the React era on purpose: versioning, export, history, and the Preview
 * all read this manifest, and none of them needed to know what language the content was
 * written in.
 */
export type GeneratedSourceManifest = {
  schemaVersion: 1;
  sourceHash: string;
  referencedMediaIds: string[];
  internalRoutes: string[];
  externalLinks: string[];
  /** True when the document ships behaviour of its own. */
  usesClientInteractivity: boolean;
  runtimeVersion: 2;
  blockUsages: GeneratedBlockUsage[];
  /** Stable Canvas element IDs a user can select in the Preview and target with AI. */
  editableElements: EditableElement[];
  /** `id` attributes the document defines, so a composed page can keep them unique. */
  elementIds: string[];
};

export type GeneratedDocumentValidationInput = {
  kind: "page" | "block";
  document: GeneratedDocument;
  approvedMediaIds: Set<string>;
  activeRoutes: Set<string>;
  declaredMediaIds?: string[];
  /** Building Block UUIDs the assembled project context authorised for reuse. */
  availableBlockIds?: Set<string>;
  declaredBlockUsages?: GeneratedBlockUsage[];
};

export type GeneratedDocumentValidationResult = {
  manifest: GeneratedSourceManifest;
  /** The canonical document: re-printed from the validated tree, never the raw input. */
  document: GeneratedDocument;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(detail: string): never {
  throw new AIError("AI_GENERATED_DOCUMENT_INVALID", generatedDocumentValidationMessage(detail), false, undefined, detail);
}

function assertElementPolicy(element: HtmlElement) {
  if (FORBIDDEN_ELEMENTS.has(element.tag)) fail(`prohibited element: ${element.tag}`);
  if (!ALLOWED_ELEMENTS.has(element.tag)) fail(`unsupported element: ${element.tag}`);
  for (const attribute of element.attributes) {
    if (attribute.name.startsWith("on")) fail(`inline event handlers are not allowed: ${attribute.name}`);
    if (attribute.name === "style") fail("inline style attributes are not allowed");
    if (!isAllowedAttribute(element.tag, attribute.name)) fail(`unsupported attribute on <${element.tag}>: ${attribute.name}`);
  }
}

function assertClassNames(element: HtmlElement) {
  const value = attributeValue(element, "class");
  if (value === null) return;
  const names = value.split(/\s+/).filter(Boolean);
  if (names.length > 12) fail("too many classes on one element");
  for (const name of names) {
    if (!GENERATED_CLASS_PATTERN.test(name)) fail(`invalid class name: ${name}`);
  }
}

function assertLink(element: HtmlElement, input: GeneratedDocumentValidationInput, routes: Set<string>, external: Set<string>, invalidRoutes: Set<string>) {
  const href = attributeValue(element, "href");
  if (href === null) fail("every link needs an href");
  const target = attributeValue(element, "target");
  if (target !== null && !ALLOWED_LINK_TARGETS.has(target)) fail(`unsupported link target: ${target}`);
  if (href.startsWith("#")) {
    // A bare "#" is the ordinary "top of this page" link and names no element.
    if (href !== "#" && !/^#[a-z][a-z0-9-]*$/.test(href)) fail(`invalid in-page link: ${href}`);
    return;
  }
  if (href.startsWith("/")) {
    const route = href.split(/[?#]/)[0] || "/";
    if (!input.activeRoutes.has(route)) invalidRoutes.add(route);
    else routes.add(route);
    return;
  }
  let url: URL;
  try { url = new URL(href); } catch { fail(`invalid link: ${href}`); }
  if (!ALLOWED_LINK_PROTOCOLS.has(url.protocol)) fail(`unsafe link scheme: ${url.protocol}`);
  external.add(href);
}

/**
 * Single security and validation authority for every generated document Canvas stores.
 *
 * Pages and Building Blocks share one policy so neither can be weakened in isolation, and
 * the result is the *canonical* document — HTML re-printed from the parsed tree and CSS
 * re-printed from the parsed rule tree — so what a browser eventually runs is exactly
 * what was checked here.
 */
export function validateGeneratedDocument(input: GeneratedDocumentValidationInput): GeneratedDocumentValidationResult {
  const { document } = input;
  const totalBytes = Buffer.byteLength(document.html, "utf8") + Buffer.byteLength(document.css, "utf8") + Buffer.byteLength(document.js, "utf8");
  if (totalBytes > GENERATED_DOCUMENT_MAX_BYTES) fail("document too large");

  let nodes: HtmlNode[];
  try {
    nodes = parseHtmlFragment(document.html);
    assertHtmlDepth(nodes);
  } catch (error) {
    fail(`invalid HTML: ${error instanceof HtmlParseError ? error.message : "could not be parsed"}`);
  }
  if (!nodes.some((node) => node.type === "element")) fail("invalid HTML: the document has no elements");

  const media = new Set<string>();
  const routes = new Set<string>();
  const external = new Set<string>();
  const invalidRoutes = new Set<string>();
  const usages: GeneratedBlockUsage[] = [];
  const usageKeys = new Set<string>();
  const canvasIds = new Set<string>();
  const elementIds = new Set<string>();
  const editableElements: EditableElement[] = [];

  walkElements(nodes, (element) => {
    assertElementPolicy(element);
    assertClassNames(element);

    const id = attributeValue(element, "id");
    if (id !== null) {
      if (!GENERATED_ID_PATTERN.test(id)) fail(`invalid element id: ${id}`);
      if (elementIds.has(id)) fail(`duplicate element id: ${id}`);
      elementIds.add(id);
    }

    if (element.tag === "a") assertLink(element, input, routes, external, invalidRoutes);
    if (element.tag === "form") {
      if (attributeValue(element, "action") !== null || attributeValue(element, "method") !== null) fail("generated forms cannot submit to an endpoint");
    }
    if (element.tag === "input") {
      const type = attributeValue(element, "type");
      if (type !== null && !ALLOWED_INPUT_TYPES.has(type)) fail(`unsupported input type: ${type}`);
    }
    if (element.tag === "img") {
      if (attributeValue(element, "src") !== null) fail("generated images cannot set src; use data-canvas-media");
      const mediaId = attributeValue(element, "data-canvas-media");
      if (!mediaId) fail("every image needs a data-canvas-media Media UUID");
      if (!UUID_PATTERN.test(mediaId) || !input.approvedMediaIds.has(mediaId)) fail(`invalid media ID: ${mediaId}`);
      media.add(mediaId);
      if (attributeValue(element, "alt") === null) fail("every image needs alt text");
    }

    const blockId = attributeValue(element, "data-canvas-block");
    if (blockId !== null) {
      if (input.kind !== "page") fail("Building Blocks cannot contain other Building Blocks");
      if (element.tag !== "div") fail("a Building Block reference must be a div");
      if (element.children.length) fail("a Building Block reference must be empty");
      const usageKey = attributeValue(element, "data-canvas-usage");
      if (!UUID_PATTERN.test(blockId)) fail(`invalid block reference: ${blockId}`);
      if (!usageKey || !USAGE_KEY_PATTERN.test(usageKey)) fail(`invalid block usage key: ${usageKey ?? "<missing>"}`);
      if (!input.availableBlockIds?.has(blockId)) fail(`invalid block reference: ${blockId}`);
      if (usageKeys.has(usageKey)) fail(`duplicate block usage key: ${usageKey}`);
      usageKeys.add(usageKey);
      usages.push({ blockId, usageKey });
      if (attributeValue(element, "data-canvas-id") !== null) fail("Building Block references cannot carry a Canvas element ID");
    } else if (attributeValue(element, "data-canvas-usage") !== null) {
      fail("data-canvas-usage without a Building Block reference");
    }

    const canvasId = attributeValue(element, "data-canvas-id");
    if (canvasId !== null) {
      if (!CANVAS_ID_PATTERN.test(canvasId)) fail(`invalid data-canvas-id value: ${canvasId}`);
      if (canvasIds.has(canvasId)) fail(`duplicate Canvas element ID: ${canvasId}`);
      canvasIds.add(canvasId);
      const label = attributeValue(element, "data-canvas-label");
      if (label !== null && label.length > CANVAS_LABEL_MAX_LENGTH) fail("data-canvas-label is too long");
      editableElements.push({ canvasId, elementType: element.tag, label });
      if (editableElements.length > EDITABLE_ELEMENT_LIMIT) fail("too many selectable Canvas elements");
    } else if (attributeValue(element, "data-canvas-label") !== null) {
      fail("data-canvas-label without a data-canvas-id");
    }
  });

  if (invalidRoutes.size) fail(`invalid internal routes: ${[...invalidRoutes].sort().join(", ")}`);
  if (!editableElements.length) fail("the document has no selectable Canvas elements");

  let css: string;
  try { css = validateGeneratedCss(document.css).css; } catch (error) {
    fail(`unsafe CSS: ${error instanceof CssValidationError ? error.message : "could not be parsed"}`);
  }

  let js: string;
  try { js = validateGeneratedJavaScript(document.js); } catch (error) {
    fail(`unsafe JavaScript: ${error instanceof JavaScriptValidationError ? error.message : "could not be parsed"}`);
  }

  const declaredMedia = new Set(input.declaredMediaIds ?? []);
  if (input.declaredMediaIds && (declaredMedia.size !== media.size || [...declaredMedia].some((id) => !media.has(id)))) fail("declared Media references do not match the document");
  if (input.declaredBlockUsages) {
    const key = (usage: GeneratedBlockUsage) => `${usage.blockId}:${usage.usageKey}`;
    const declaredUsages = new Set(input.declaredBlockUsages.map(key));
    if (declaredUsages.size !== usages.length || usages.some((usage) => !declaredUsages.has(key(usage)))) fail("declared Building Block usages do not match the document");
  }

  const canonical: GeneratedDocument = {
    ...emptyDocument(),
    schemaVersion: 1,
    html: serializeHtml(nodes),
    css,
    js,
    metadata: input.kind === "page" ? (document.metadata ?? { title: null, description: null }) : null,
  };

  const sourceHash = createHash("sha256")
    .update(`${canonical.html} ${canonical.css} ${canonical.js}`)
    .digest("hex");

  return {
    document: canonical,
    manifest: {
      schemaVersion: 1,
      sourceHash,
      referencedMediaIds: [...media].sort(),
      internalRoutes: [...routes].sort(),
      externalLinks: [...external].sort(),
      usesClientInteractivity: canonical.js.length > 0,
      runtimeVersion: 2,
      blockUsages: [...usages].sort((a, b) => a.usageKey.localeCompare(b.usageKey)),
      editableElements,
      elementIds: [...elementIds].sort(),
    },
  };
}
