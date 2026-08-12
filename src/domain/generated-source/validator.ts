import { createHash } from "node:crypto";
import ts from "typescript";
import { AIError } from "@/domain/ai/provider";
import { compileGeneratedSource, type GeneratedBlockModule } from "./compiler";
import { GENERATED_SOURCE_MAX_BYTES, USAGE_KEY_PATTERN } from "./limits";

export { GENERATED_SOURCE_MAX_BYTES, USAGE_KEY_PATTERN };

const ALLOWED_IMPORTS = new Set(["react", "@canvas/site-runtime"]);
const FORBIDDEN_GLOBALS = new Set(["eval", "require", "fetch", "XMLHttpRequest", "WebSocket", "EventSource", "process", "Buffer", "Deno", "Bun", "globalThis", "localStorage", "sessionStorage", "indexedDB"]);
const FORBIDDEN_PROPERTIES = new Set(["eval", "Function", "require", "fetch", "XMLHttpRequest", "WebSocket", "EventSource", "cookie", "sendBeacon", "parent", "top", "opener", "postMessage", "localStorage", "sessionStorage", "indexedDB", "innerHTML", "outerHTML", "write", "createElement"]);
const FORBIDDEN_ELEMENTS = new Set(["script", "iframe", "object", "embed", "img", "image", "link", "base", "audio", "video", "source"]);

export type GeneratedBlockUsage = { blockId: string; usageKey: string };
export type GeneratedSourceManifest = {
  schemaVersion: 1;
  sourceHash: string;
  referencedMediaIds: string[];
  internalRoutes: string[];
  externalLinks: string[];
  usesClientInteractivity: boolean;
  runtimeVersion: 1;
  blockUsages: GeneratedBlockUsage[];
};

export type GeneratedSourceValidationInput = {
  kind: "page" | "block";
  sourceCode: string;
  approvedMediaIds: Set<string>;
  activeRoutes: Set<string>;
  declaredMediaIds?: string[];
  /** Building Block UUIDs the assembled project context authorised for reuse. */
  availableBlockIds?: Set<string>;
  declaredBlockUsages?: GeneratedBlockUsage[];
  /** Validated source of each referenced Building Block, used for the real compile. */
  blockSources?: Map<string, string>;
};

function fail(detail: string): never {
  throw new AIError("AI_PROVIDER_INVALID_RESPONSE", "Canvas could not produce valid website code from this request. Try again.", false, undefined, detail);
}
function literal(node: ts.Expression | undefined) {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;
}
function jsxAttribute(node: ts.JsxAttributes, name: string) {
  const attribute = node.properties.find((item): item is ts.JsxAttribute => ts.isJsxAttribute(item) && item.name.getText() === name);
  if (!attribute?.initializer) return null;
  if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer.text;
  return ts.isJsxExpression(attribute.initializer) ? literal(attribute.initializer.expression) : null;
}

/**
 * Single security/validation authority for every generated component Canvas stores.
 * Pages and Building Blocks share one policy so neither can be weakened in isolation.
 */
export async function validateGeneratedSource(input: GeneratedSourceValidationInput): Promise<GeneratedSourceManifest> {
  if (Buffer.byteLength(input.sourceCode, "utf8") > GENERATED_SOURCE_MAX_BYTES) fail("source too large");
  if (/\b(import\s*\(|new\s+Function\b|document\.write\b|dangerouslySetInnerHTML\b|@import\b|url\s*\(\s*["']?(?:https?:|data:))/i.test(input.sourceCode)) fail("prohibited dynamic code or CSS resource");
  const allowedComponents = input.kind === "page" ? new Set(["CanvasImage", "CanvasBlock"]) : new Set(["CanvasImage"]);
  const file = ts.createSourceFile(`generated-${input.kind}.tsx`, input.sourceCode, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const parseDiagnostics = (file as ts.SourceFile & { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics;
  if (parseDiagnostics.length) fail(`TSX syntax: ${parseDiagnostics[0]?.messageText}`);
  const media = new Set<string>(); const routes = new Set<string>(); const external = new Set<string>();
  const usages: GeneratedBlockUsage[] = []; const usageKeys = new Set<string>();
  let defaultExport = false; let interactive = false;

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) { const moduleName = literal(node.moduleSpecifier); if (!moduleName || !ALLOWED_IMPORTS.has(moduleName)) fail(`forbidden import: ${moduleName ?? "dynamic"}`); }
    if (ts.isExportAssignment(node) && !node.isExportEquals) defaultExport = true;
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.modifiers?.some((item) => item.kind === ts.SyntaxKind.DefaultKeyword) && node.modifiers.some((item) => item.kind === ts.SyntaxKind.ExportKeyword)) defaultExport = true;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) { if (FORBIDDEN_GLOBALS.has(node.expression.text)) fail(`prohibited API: ${node.expression.text}`); if (/^use(State|Reducer|Effect|Memo|Callback|Ref)$/.test(node.expression.text)) interactive = true; }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && (node.expression.text === "Function" || ["WebSocket", "XMLHttpRequest", "EventSource"].includes(node.expression.text))) fail(`prohibited constructor: ${node.expression.text}`);
    if (ts.isIdentifier(node) && FORBIDDEN_GLOBALS.has(node.text) && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)) fail(`prohibited global: ${node.text}`);
    if (ts.isPropertyAccessExpression(node) && FORBIDDEN_PROPERTIES.has(node.name.text)) fail(`prohibited property: ${node.name.text}`);
    if (ts.isElementAccessExpression(node)) { const property = literal(node.argumentExpression); if (property && FORBIDDEN_PROPERTIES.has(property)) fail(`prohibited property: ${property}`); }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(); const lower = tag.toLowerCase();
      if (FORBIDDEN_ELEMENTS.has(lower)) fail(`prohibited element: ${tag}`);
      if (/^[A-Z]/.test(tag) && !allowedComponents.has(tag)) fail(`custom component elements are not allowed: ${tag}`);
      if (node.attributes.properties.some((item) => ts.isJsxAttribute(item) && item.name.getText() === "style")) fail("inline style attributes are not allowed");
      const classAttribute = node.attributes.properties.find((item): item is ts.JsxAttribute => ts.isJsxAttribute(item) && item.name.getText() === "className");
      if (classAttribute && jsxAttribute(node.attributes, "className") === null) fail("className must be a static string");
      if (tag === "CanvasImage") { const id = jsxAttribute(node.attributes, "mediaId"); if (!id) fail("CanvasImage mediaId must be a static UUID"); if (!input.approvedMediaIds.has(id)) fail(`invalid media ID: ${id}`); media.add(id); }
      if (tag === "CanvasBlock") {
        const blockId = jsxAttribute(node.attributes, "blockId"); const usageKey = jsxAttribute(node.attributes, "usageKey");
        if (!blockId) fail("CanvasBlock blockId must be a static UUID");
        if (!usageKey) fail("CanvasBlock usageKey must be a static key");
        if (!USAGE_KEY_PATTERN.test(usageKey)) fail(`invalid block usage key: ${usageKey}`);
        if (!input.availableBlockIds?.has(blockId)) fail(`invalid block reference: ${blockId}`);
        if (usageKeys.has(usageKey)) fail(`duplicate block usage key: ${usageKey}`);
        usageKeys.add(usageKey); usages.push({ blockId, usageKey });
      }
      if (lower === "form" && node.attributes.properties.some((item) => ts.isJsxAttribute(item) && ["action", "method"].includes(item.name.getText()))) fail("generated forms cannot submit to an endpoint");
      if (lower === "a") {
        const href = jsxAttribute(node.attributes, "href");
        if (!href) fail("Anchor href must be static");
        if (href.startsWith("#")) { /* local anchor */ }
        else if (href.startsWith("/")) { const route = href.split(/[?#]/)[0] || "/"; if (!input.activeRoutes.has(route)) fail(`invalid internal route: ${route}`); routes.add(route); }
        else { let url: URL; try { url = new URL(href); } catch { fail(`invalid link: ${href}`); } if (!["http:", "https:", "mailto:", "tel:"].includes(url.protocol)) fail(`unsafe link scheme: ${url.protocol}`); external.add(href); }
      }
      for (const property of node.attributes.properties) if (ts.isJsxAttribute(property) && /^on[A-Z]/.test(property.name.getText())) interactive = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);

  if (!defaultExport) fail(`${input.kind} must have one default export`);
  const declaredMedia = new Set(input.declaredMediaIds ?? []);
  if (declaredMedia.size !== media.size || [...declaredMedia].some((id) => !media.has(id))) fail("declared Media references do not match source");
  if (input.declaredBlockUsages) {
    const key = (usage: GeneratedBlockUsage) => `${usage.blockId}:${usage.usageKey}`;
    const declaredUsages = new Set(input.declaredBlockUsages.map(key));
    if (declaredUsages.size !== usages.length || usages.some((usage) => !declaredUsages.has(key(usage)))) fail("declared Building Block usages do not match source");
  }

  const modules: GeneratedBlockModule[] = [];
  for (const blockId of new Set(usages.map((usage) => usage.blockId))) {
    const source = input.blockSources?.get(blockId);
    if (!source) fail(`referenced Building Block has no active version: ${blockId}`);
    modules.push({ blockId, sourceCode: source });
  }
  const sourceHash = createHash("sha256").update(input.sourceCode.replace(/\r\n/g, "\n")).digest("hex");
  await compileGeneratedSource({ entrySource: input.sourceCode, blocks: modules });
  return {
    schemaVersion: 1, sourceHash, referencedMediaIds: [...media].sort(), internalRoutes: [...routes].sort(),
    externalLinks: [...external].sort(), usesClientInteractivity: interactive, runtimeVersion: 1,
    blockUsages: [...usages].sort((a, b) => a.usageKey.localeCompare(b.usageKey)),
  };
}
