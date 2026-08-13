import ts from "typescript";

export type MediaTarget = { assetPath: string; width: number; height: number; altText: string | null };
export type BlockTarget = { componentName: string; importPath: string };

export type TransformInput = {
  sourceCode: string;
  /** Media UUID → local public asset. */
  media: Map<string, MediaTarget>;
  /** `blockId:usageKey` → exported component for that usage's resolved version. */
  blocks: Map<string, BlockTarget>;
  /** Name the exported component should have. */
  componentName: string;
  forceClient: boolean;
};

const CANVAS_ATTRIBUTES = new Set(["data-canvas-id", "data-canvas-label", "data-canvas-block", "data-canvas-usage"]);
const factory = ts.factory;

function staticAttribute(attributes: ts.JsxAttributes, name: string) {
  const attribute = attributes.properties.find((item): item is ts.JsxAttribute => ts.isJsxAttribute(item) && item.name.getText() === name);
  if (!attribute?.initializer) return null;
  if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer.text;
  if (ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression && ts.isStringLiteral(attribute.initializer.expression)) return attribute.initializer.expression.text;
  return null;
}
function keptAttributes(attributes: ts.JsxAttributes, drop: Set<string>) {
  return attributes.properties.filter((item) => !(ts.isJsxAttribute(item) && (CANVAS_ATTRIBUTES.has(item.name.getText()) || drop.has(item.name.getText()))));
}
function stringAttribute(name: string, value: string) {
  return factory.createJsxAttribute(factory.createIdentifier(name), factory.createStringLiteral(value));
}
function numberAttribute(name: string, value: number) {
  return factory.createJsxAttribute(factory.createIdentifier(name), factory.createJsxExpression(undefined, factory.createNumericLiteral(value)));
}

/**
 * Rewrites one validated generated component into a standalone React component:
 * Canvas runtime primitives become plain elements and local imports, and every
 * editor-only `data-canvas-*` attribute is stripped.
 */
export function transformGeneratedSource(input: TransformInput) {
  const file = ts.createSourceFile("generated.tsx", input.sourceCode, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const usedBlocks = new Map<string, BlockTarget>();
  const usedMedia = new Set<string>();
  let missing: string | null = null;

  const visitor = (context: ts.TransformationContext) => {
    const visit = (node: ts.Node): ts.Node | ts.Node[] | undefined => {
      // Drop the Canvas runtime import; replacements are imported per component.
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === "@canvas/site-runtime") return undefined;

      if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
        const tag = node.tagName.getText();
        if (tag === "CanvasImage") {
          const mediaId = staticAttribute(node.attributes, "mediaId");
          const target = mediaId ? input.media.get(mediaId) : null;
          if (!mediaId || !target) { missing ??= `media ${mediaId ?? "reference"}`; return node; }
          usedMedia.add(mediaId);
          const alt = staticAttribute(node.attributes, "alt") ?? target.altText ?? "";
          const attributes = factory.createJsxAttributes([
            ...keptAttributes(node.attributes, new Set(["mediaId", "alt", "width", "height", "src"])) as ts.JsxAttributeLike[],
            stringAttribute("src", target.assetPath), stringAttribute("alt", alt),
            numberAttribute("width", target.width), numberAttribute("height", target.height),
            stringAttribute("loading", "lazy"), stringAttribute("decoding", "async"),
          ]);
          return factory.createJsxSelfClosingElement(factory.createIdentifier("img"), undefined, attributes);
        }
        if (tag === "CanvasBlock") {
          const blockId = staticAttribute(node.attributes, "blockId");
          const usageKey = staticAttribute(node.attributes, "usageKey");
          const target = blockId && usageKey ? input.blocks.get(`${blockId}:${usageKey}`) : null;
          if (!target) { missing ??= `Building Block ${blockId ?? "reference"}`; return node; }
          usedBlocks.set(target.componentName, target);
          return factory.createJsxSelfClosingElement(factory.createIdentifier(target.componentName), undefined, factory.createJsxAttributes([]));
        }
        const remaining = keptAttributes(node.attributes, new Set()) as ts.JsxAttributeLike[];
        if (remaining.length !== node.attributes.properties.length) {
          const attributes = factory.createJsxAttributes(remaining);
          return ts.isJsxSelfClosingElement(node)
            ? factory.createJsxSelfClosingElement(node.tagName, node.typeArguments, attributes)
            : factory.createJsxOpeningElement(node.tagName, node.typeArguments, attributes);
        }
      }
      return ts.visitEachChild(node, visit, context);
    };
    return (root: ts.SourceFile) => ts.visitNode(root, visit) as ts.SourceFile;
  };

  const result = ts.transform(file, [visitor]);
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  let output = printer.printFile(result.transformed[0] as ts.SourceFile);
  result.dispose();
  if (missing) throw new Error(`Export could not resolve ${missing}.`);

  // Rename the default export so several components can coexist in one project.
  output = output.replace(/export\s+default\s+function\s+[A-Za-z0-9_$]*\s*\(/, `export default function ${input.componentName}(`);
  const directive = /^\s*["']use client["']/.test(output);
  const imports = [...usedBlocks.values()].map((block) => `import ${block.componentName} from "${block.importPath}";`).join("\n");
  const header = [input.forceClient && !directive ? `"use client";\n` : "", imports ? `${imports}\n` : ""].join("");
  if (header) {
    output = directive
      ? output.replace(/^(\s*["']use client["'];?\s*\n)/, (match) => `${match}${header}`)
      : `${header}${output}`;
  }
  return { code: output.trimStart(), mediaIds: [...usedMedia], blocks: [...usedBlocks.values()] };
}

/** True when a component must run on the client (hooks or DOM event handlers). */
export function requiresClientRuntime(sourceCode: string, manifest: unknown) {
  if (manifest && typeof manifest === "object" && (manifest as { usesClientInteractivity?: unknown }).usesClientInteractivity === true) return true;
  return /\buse(State|Reducer|Effect|Memo|Callback|Ref)\s*\(|\bon[A-Z][A-Za-z]*\s*=\s*\{/.test(sourceCode);
}
