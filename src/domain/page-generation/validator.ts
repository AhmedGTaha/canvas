import { createHash } from "node:crypto";
import { build, type Plugin } from "esbuild";
import ts from "typescript";
import { AIError } from "@/domain/ai/provider";
import { PAGE_SOURCE_MAX_BYTES } from "./contract";

const ALLOWED_IMPORTS = new Set(["react", "@canvas/site-runtime"]);
const FORBIDDEN_GLOBALS = new Set(["eval", "require", "fetch", "XMLHttpRequest", "WebSocket", "EventSource", "process", "Buffer", "Deno", "Bun", "globalThis", "localStorage", "sessionStorage", "indexedDB"]);
const FORBIDDEN_PROPERTIES = new Set(["eval", "Function", "require", "fetch", "XMLHttpRequest", "WebSocket", "EventSource", "cookie", "sendBeacon", "parent", "top", "opener", "postMessage", "localStorage", "sessionStorage", "indexedDB", "innerHTML", "outerHTML", "write", "createElement"]);
const FORBIDDEN_ELEMENTS = new Set(["script", "iframe", "object", "embed", "img", "image", "link", "base", "audio", "video", "source"]);

export type GeneratedPageManifest = { schemaVersion: 1; sourceHash: string; referencedMediaIds: string[]; internalRoutes: string[]; externalLinks: string[]; usesClientInteractivity: boolean; runtimeVersion: 1 };

function fail(detail: string): never { throw new AIError("AI_PROVIDER_INVALID_RESPONSE", "Canvas could not produce a valid page from this request. Try again.", false, undefined, detail); }
function literal(node: ts.Expression | undefined) { return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null; }
function jsxAttribute(node: ts.JsxAttributes, name: string) { const attribute = node.properties.find((item): item is ts.JsxAttribute => ts.isJsxAttribute(item) && item.name.getText() === name); if (!attribute?.initializer) return null; if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer.text; return ts.isJsxExpression(attribute.initializer) ? literal(attribute.initializer.expression) : null; }

export async function validateGeneratedPageSource(input: { sourceCode: string; approvedMediaIds: Set<string>; activeRoutes: Set<string>; declaredMediaIds?: string[] }) {
  if (Buffer.byteLength(input.sourceCode, "utf8") > PAGE_SOURCE_MAX_BYTES) fail("source too large");
  if (/\b(import\s*\(|new\s+Function\b|document\.write\b|dangerouslySetInnerHTML\b|@import\b|url\s*\(\s*["']?(?:https?:|data:))/i.test(input.sourceCode)) fail("prohibited dynamic code or CSS resource");
  const file = ts.createSourceFile("generated-page.tsx", input.sourceCode, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const parseDiagnostics = (file as ts.SourceFile & { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics;
  if (parseDiagnostics.length) fail(`TSX syntax: ${parseDiagnostics[0]?.messageText}`);
  const media = new Set<string>(); const routes = new Set<string>(); const external = new Set<string>(); let defaultExport = false; let interactive = false;
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
      if (/^[A-Z]/.test(tag) && tag !== "CanvasImage") fail(`custom component elements are not allowed: ${tag}`);
      if (node.attributes.properties.some((item) => ts.isJsxAttribute(item) && item.name.getText() === "style")) fail("inline style attributes are not allowed");
      const classAttribute = node.attributes.properties.find((item): item is ts.JsxAttribute => ts.isJsxAttribute(item) && item.name.getText() === "className");
      if (classAttribute && jsxAttribute(node.attributes, "className") === null) fail("className must be a static string");
      if (tag === "CanvasImage") { const id = jsxAttribute(node.attributes, "mediaId"); if (!id) fail("CanvasImage mediaId must be a static UUID"); if (!input.approvedMediaIds.has(id)) fail(`invalid media ID: ${id}`); media.add(id); }
      if (lower === "form" && node.attributes.properties.some((item) => ts.isJsxAttribute(item) && ["action", "method"].includes(item.name.getText()))) fail("generated forms cannot submit to an endpoint");
      if (lower === "a") { const href = jsxAttribute(node.attributes, "href"); if (!href) fail("Anchor href must be static"); if (href.startsWith("#")) { /* local */ } else if (href.startsWith("/")) { const route = href.split(/[?#]/)[0] || "/"; if (!input.activeRoutes.has(route)) fail(`invalid internal route: ${route}`); routes.add(route); } else { let url: URL; try { url = new URL(href); } catch { fail(`invalid link: ${href}`); } if (!["http:", "https:", "mailto:", "tel:"].includes(url.protocol)) fail(`unsafe link scheme: ${url.protocol}`); external.add(href); } }
      for (const property of node.attributes.properties) if (ts.isJsxAttribute(property) && /^on[A-Z]/.test(property.name.getText())) interactive = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!defaultExport) fail("page must have one default export");
  const declared = new Set(input.declaredMediaIds ?? []); if (declared.size !== media.size || [...declared].some((id) => !media.has(id))) fail("declared Media references do not match source");
  const sourceHash = createHash("sha256").update(input.sourceCode.replace(/\r\n/g, "\n")).digest("hex");
  await compileGeneratedPage(input.sourceCode);
  return { schemaVersion: 1, sourceHash, referencedMediaIds: [...media].sort(), internalRoutes: [...routes].sort(), externalLinks: [...external].sort(), usesClientInteractivity: interactive, runtimeVersion: 1 } satisfies GeneratedPageManifest;
}

const siteRuntimeSource = `import React from "react";
export function CanvasImage({mediaId,alt="",...props}){const item=globalThis.__CANVAS_PREVIEW__?.media?.[mediaId];if(!item)return null;return React.createElement("img",{...props,src:item.previewUrl,alt:alt||item.altText||"",width:props.width||item.width,height:props.height||item.height});}`;

export async function compileGeneratedPage(sourceCode: string) {
  const virtual: Plugin = { name: "canvas-controlled-modules", setup(plugin) {
    plugin.onResolve({ filter: /^generated-page$/ }, () => ({ path: "generated-page", namespace: "canvas" }));
    plugin.onResolve({ filter: /^@canvas\/site-runtime$/ }, () => ({ path: "site-runtime", namespace: "canvas" }));
    plugin.onLoad({ filter: /^generated-page$/, namespace: "canvas" }, () => ({ contents: sourceCode, loader: "tsx", resolveDir: process.cwd() }));
    plugin.onLoad({ filter: /^site-runtime$/, namespace: "canvas" }, () => ({ contents: siteRuntimeSource, loader: "jsx", resolveDir: process.cwd() }));
    plugin.onResolve({ filter: /.*/ }, (args) => { if (args.kind === "entry-point" || args.path === "react" || args.path === "react-dom/client" || args.path.startsWith("react/") || args.importer.includes("node_modules")) return undefined; return { errors: [{ text: `Import is not allowed: ${args.path}` }] }; });
  } };
  try {
    const result = await build({ stdin: { contents: `import React from "react";import{createRoot}from"react-dom/client";import Page from "generated-page";const root=document.getElementById("generated-root");if(root)createRoot(root).render(React.createElement(Page));`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", platform: "browser", target: ["es2020"], jsx: "automatic", plugins: [virtual], logLevel: "silent" });
    const output = result.outputFiles[0]?.text; if (!output) fail("compiler produced no output"); return output;
  } catch (error) { fail(`compile failed: ${error instanceof Error ? error.message : "unknown"}`); }
}
