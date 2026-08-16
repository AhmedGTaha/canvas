import ts from "typescript";
import { USAGE_KEY_PATTERN } from "@/domain/generated-source/limits";

/**
 * Editing a page's section list in its own source.
 *
 * A reusable section is present on a page because the page's active source contains a
 * `<CanvasBlock blockId=… usageKey=… />` element. That element is the usage. Nothing
 * else — not the usage row, not the manifest, not the Preview — decides whether the
 * section renders, so "remove this section from the page" has to mean "produce source
 * without that element", and everything downstream then follows from re-validating it.
 *
 * These functions only ever move whole JSX elements and never touch anything else in
 * the file, so the rest of a generated page comes through byte-for-byte and the result
 * still has to pass the ordinary generated-source validator before it can be stored.
 */

export type SectionPlacement =
  | { position: "top" }
  | { position: "bottom" }
  | { position: "before"; anchor: string }
  | { position: "after"; anchor: string };

export class PageSourceEditError extends Error {
  constructor(message: string, readonly reason: "no-root" | "usage-not-found" | "anchor-not-found" | "duplicate-usage") {
    super(message);
    this.name = "PageSourceEditError";
  }
}

type JsxChild = ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment;

function parse(sourceCode: string) {
  return ts.createSourceFile("page.tsx", sourceCode, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
}

function isJsxChild(node: ts.Node): node is JsxChild {
  return ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node);
}

/** The outermost JSX element in the file: the page's root markup. */
function rootJsx(file: ts.SourceFile): JsxChild | null {
  let found: JsxChild | null = null;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (isJsxChild(node)) { found = node; return; }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** The element children of the page root, in document order. */
function rootChildren(root: JsxChild): JsxChild[] {
  if (ts.isJsxSelfClosingElement(root)) return [];
  return root.children.filter(isJsxChild);
}

function staticAttribute(element: JsxChild, name: string): string | null {
  const attributes = ts.isJsxSelfClosingElement(element) ? element.attributes : ts.isJsxElement(element) ? element.openingElement.attributes : null;
  if (!attributes) return null;
  const attribute = attributes.properties.find((item): item is ts.JsxAttribute => ts.isJsxAttribute(item) && item.name.getText() === name);
  const initializer = attribute?.initializer;
  if (!initializer) return null;
  if (ts.isStringLiteral(initializer)) return initializer.text;
  if (ts.isJsxExpression(initializer) && initializer.expression && ts.isStringLiteral(initializer.expression)) return initializer.expression.text;
  return null;
}

function tagOf(element: JsxChild) {
  if (ts.isJsxSelfClosingElement(element)) return element.tagName.getText();
  if (ts.isJsxElement(element)) return element.openingElement.tagName.getText();
  return "";
}

/** Every `usageKey` already used anywhere in this page's source. */
export function existingUsageKeys(sourceCode: string): string[] {
  const file = parse(sourceCode);
  const keys: string[] = [];
  const visit = (node: ts.Node) => {
    if (isJsxChild(node) && tagOf(node) === "CanvasBlock") { const key = staticAttribute(node, "usageKey"); if (key) keys.push(key); }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return keys;
}

/**
 * A stable, readable usage key derived from a section's name, made unique against the
 * keys already on the page. Keys are part of the source contract, so this produces only
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

const RUNTIME_MODULE = "@canvas/site-runtime";

/**
 * Makes sure `CanvasBlock` is in scope.
 *
 * `<CanvasBlock />` is an ordinary identifier once the source is compiled, so a page that
 * references it without importing it compiles cleanly and then throws
 * "CanvasBlock is not defined" in the browser. Inserting the element and inserting the
 * import are therefore the same operation, never two.
 *
 * An existing `@canvas/site-runtime` import gains the named binding; otherwise a new
 * import is placed above the first statement, after any "use client" directive.
 */
function ensureCanvasBlockImport(sourceCode: string): string {
  const file = parse(sourceCode);
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== RUNTIME_MODULE) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    if (bindings.elements.some((element) => element.name.text === "CanvasBlock")) return sourceCode;
    // Append to the existing named import rather than adding a second one from the same
    // module, which reads as an accident in the exported source.
    const last = bindings.elements[bindings.elements.length - 1];
    const at = last ? last.getEnd() : bindings.getEnd() - 1;
    return `${sourceCode.slice(0, at)}, CanvasBlock${sourceCode.slice(at)}`;
  }
  const directive = file.statements.find((statement) => ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression));
  const at = directive ? directive.getEnd() : (file.statements[0]?.getStart(file) ?? 0);
  const line = `import { CanvasBlock } from "${RUNTIME_MODULE}";`;
  return directive
    ? `${sourceCode.slice(0, at)}\n${line}${sourceCode.slice(at)}`
    : `${line}\n${sourceCode.slice(0, at)}${sourceCode.slice(at)}`;
}

/**
 * Drops the `CanvasBlock` import once the last reference to it is gone.
 *
 * The mirror of `ensureCanvasBlockImport`. Exported projects are source someone reads and
 * owns, and an import of something the file no longer uses is a loose end — so removing
 * the last section removes its import too. Any other binding from the same module stays;
 * only an import left with nothing in it is deleted outright.
 */
function dropUnusedCanvasBlockImport(sourceCode: string): string {
  const file = parse(sourceCode);
  let referenced = false;
  const visit = (node: ts.Node) => {
    if (referenced) return;
    if (isJsxChild(node) && tagOf(node) === "CanvasBlock") { referenced = true; return; }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (referenced) return sourceCode;

  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== RUNTIME_MODULE) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    const target = bindings.elements.find((element) => element.name.text === "CanvasBlock");
    if (!target) continue;
    if (bindings.elements.length === 1) {
      // Nothing left in the import: take the whole line, and the newline after it.
      const start = statement.getStart(file);
      const lineStart = sourceCode.lastIndexOf("\n", start - 1) + 1;
      const end = sourceCode.indexOf("\n", statement.getEnd());
      return sourceCode.slice(0, /^\s*$/.test(sourceCode.slice(lineStart, start)) ? lineStart : start) + (end === -1 ? "" : sourceCode.slice(end + 1));
    }
    const index = bindings.elements.indexOf(target);
    const previous = bindings.elements[index - 1];
    // Swallow the separating comma on whichever side the binding sits.
    const from = previous ? previous.getEnd() : target.getStart(file);
    const to = previous ? target.getEnd() : bindings.elements[index + 1]!.getStart(file);
    return sourceCode.slice(0, from) + sourceCode.slice(to);
  }
  return sourceCode;
}

/** The whitespace that precedes `position` on its own line, used to indent an insertion. */
function indentAt(sourceCode: string, position: number) {
  const lineStart = sourceCode.lastIndexOf("\n", position - 1) + 1;
  const slice = sourceCode.slice(lineStart, position);
  return /^\s*$/.test(slice) ? slice : "  ";
}

/**
 * Removes one `<CanvasBlock usageKey="…" />` element from a page's source.
 *
 * The element is taken out with the blank line it sat on, so removing a section does not
 * leave a hole in the file's shape. Everything else is untouched.
 */
export function removeBlockUsageFromSource(sourceCode: string, usageKey: string): string {
  const file = parse(sourceCode);
  let target: JsxChild | null = null;
  const visit = (node: ts.Node) => {
    if (!target && isJsxChild(node) && tagOf(node) === "CanvasBlock" && staticAttribute(node, "usageKey") === usageKey) { target = node; return; }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!target) throw new PageSourceEditError("That section is not on this page.", "usage-not-found");

  const element = target as JsxChild;
  let start = element.getStart(file);
  let end = element.getEnd();
  // Swallow the line the element occupied when it was alone on it.
  const lineStart = sourceCode.lastIndexOf("\n", start - 1) + 1;
  if (/^\s*$/.test(sourceCode.slice(lineStart, start))) {
    const lineEnd = sourceCode.indexOf("\n", end);
    if (lineEnd !== -1 && /^\s*$/.test(sourceCode.slice(end, lineEnd))) { start = lineStart; end = lineEnd + 1; }
  }
  return dropUnusedCanvasBlockImport(sourceCode.slice(0, start) + sourceCode.slice(end));
}

/**
 * Inserts a `<CanvasBlock />` reference into a page's source at a logical position.
 *
 * Placement is expressed in terms of the page's own top-level sections: the top or the
 * bottom of the page, or beside a section the user has selected in the Preview. An
 * anchor is matched by `data-canvas-id` or by an existing `usageKey`; when the anchor is
 * nested inside a section, the whole containing section is what the new one lands beside,
 * because that is what "after this section" means to the person who asked for it.
 */
export function insertBlockUsageIntoSource(sourceCode: string, input: { blockId: string; usageKey: string; placement: SectionPlacement }): string {
  const file = parse(sourceCode);
  const root = rootJsx(file);
  if (!root) throw new PageSourceEditError("This page has no markup to add a section to.", "no-root");
  const children = rootChildren(root);
  const element = `<CanvasBlock blockId="${input.blockId}" usageKey="${input.usageKey}" />`;

  // A root with no element children (or a self-closing root) gets the section as its
  // only child, which also covers a page that was emptied down to a bare wrapper.
  if (!children.length) {
    if (ts.isJsxSelfClosingElement(root)) throw new PageSourceEditError("This page has no container to add a section to.", "no-root");
    const open = ts.isJsxElement(root) ? root.openingElement.getEnd() : root.openingFragment.getEnd();
    const indent = `${indentAt(sourceCode, ts.isJsxElement(root) ? root.openingElement.getStart(file) : root.getStart(file))}  `;
    return ensureCanvasBlockImport(`${sourceCode.slice(0, open)}\n${indent}${element}${sourceCode.slice(open)}`);
  }

  const anchorKey = "anchor" in input.placement ? input.placement.anchor : null;
  let index: number;
  if (input.placement.position === "top") index = 0;
  else if (input.placement.position === "bottom") index = children.length;
  else {
    const found = children.findIndex((child) => matchesAnchor(child, anchorKey!, file));
    if (found === -1) throw new PageSourceEditError("The section you selected is no longer on this page.", "anchor-not-found");
    index = input.placement.position === "before" ? found : found + 1;
  }

  if (index >= children.length) {
    const last = children[children.length - 1]!;
    const at = last.getEnd();
    return ensureCanvasBlockImport(`${sourceCode.slice(0, at)}\n${indentAt(sourceCode, last.getStart(file))}${element}${sourceCode.slice(at)}`);
  }
  const next = children[index]!;
  const at = next.getStart(file);
  return ensureCanvasBlockImport(`${sourceCode.slice(0, at)}${element}\n${indentAt(sourceCode, at)}${sourceCode.slice(at)}`);
}

/** True when `child`, or anything inside it, carries the anchor id or usage key. */
function matchesAnchor(child: JsxChild, anchor: string, file: ts.SourceFile): boolean {
  let matched = false;
  const visit = (node: ts.Node) => {
    if (matched) return;
    if (isJsxChild(node)) {
      if (staticAttribute(node, "data-canvas-id") === anchor) { matched = true; return; }
      if (tagOf(node) === "CanvasBlock" && staticAttribute(node, "usageKey") === anchor) { matched = true; return; }
    }
    ts.forEachChild(node, visit);
  };
  visit(child);
  void file;
  return matched;
}
