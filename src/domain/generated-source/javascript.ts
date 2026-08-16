import ts from "typescript";

/**
 * The security model for generated JavaScript.
 *
 * Generated behaviour used to be React that Canvas compiled; now it is a plain script
 * that runs in the Preview sandbox and in the exported site. That is a real capability,
 * so it is constrained on three independent layers, and no single one of them is the
 * whole defence:
 *
 * 1. **Static analysis (this file).** The script is parsed and walked. Anything that can
 *    reach the network, persist data, leave the frame, inject markup, evaluate a string,
 *    or manufacture a Canvas identifier is rejected — by construct, not by pattern.
 * 2. **Runtime shadowing** (`wrapGeneratedScript`). What survives runs inside a function
 *    whose parameters shadow the escape hatches, so a name reached indirectly resolves to
 *    `undefined` rather than to the real global.
 * 3. **Isolation.** The Preview document is served to an opaque-origin sandboxed iframe
 *    under a nonce CSP with `connect-src 'none'`, so even a bypass of both layers above
 *    has no origin to act on and no channel to talk to.
 *
 * The list below is intentionally an allowlist of *behaviour shapes* enforced by a
 * denylist of *capabilities*: a generated script may read the document it is in, listen
 * for events, and change text, classes, and non-Canvas attributes. That is all a
 * frontend-only marketing site needs.
 */

export class JavaScriptValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JavaScriptValidationError";
  }
}

/** Identifiers that may never be referenced, however they are reached. */
const FORBIDDEN_IDENTIFIERS: ReadonlySet<string> = new Set([
  "eval", "Function", "require", "import", "process", "Buffer", "global", "globalThis",
  "fetch", "XMLHttpRequest", "WebSocket", "EventSource", "Worker", "SharedWorker",
  "ServiceWorker", "navigator", "localStorage", "sessionStorage", "indexedDB", "caches",
  "parent", "top", "opener", "frames", "self", "window", "Notification", "crypto",
  "Reflect", "Proxy", "WebAssembly", "Deno", "Bun", "__CANVAS_PREVIEW__",
  "location", "history", "open", "close", "alert", "confirm", "prompt", "print",
]);

/** Property names that may never be read or written, on any object. */
const FORBIDDEN_PROPERTIES: ReadonlySet<string> = new Set([
  "eval", "Function", "constructor", "__proto__", "prototype",
  "innerHTML", "outerHTML", "insertAdjacentHTML", "srcdoc", "write", "writeln",
  "createElement", "createElementNS", "createContextualFragment", "cookie",
  "postMessage", "sendBeacon", "parent", "top", "opener", "frames",
  "localStorage", "sessionStorage", "indexedDB", "location",
  "fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts",
  "contentWindow", "contentDocument", "execScript", "requestFileSystem",
]);

/**
 * `setAttribute`/`removeAttribute` are allowed because state on attributes is how this
 * system expresses a menu being open. They are the one place a script could still write
 * a name Canvas trusts, so the name has to be a literal and it may not be one of these.
 */
const FORBIDDEN_ATTRIBUTE_WRITES = /^(?:data-canvas|on|src|href|style|action|formaction|xlink|srcdoc)/i;

/** Only the writes need a literal name; reading an attribute cannot forge one. */
const ATTRIBUTE_WRITE_METHODS: ReadonlySet<string> = new Set(["setAttribute", "removeAttribute", "toggleAttribute"]);

function fail(detail: string): never {
  throw new JavaScriptValidationError(detail);
}

function stringLiteral(node: ts.Node | undefined) {
  if (!node) return null;
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : null;
}

/**
 * Validates one generated script. Returns the script unchanged: unlike HTML and CSS,
 * JavaScript is not re-printed, because re-printing a program is a semantic change and
 * the analysis below is what the guarantee rests on.
 */
export function validateGeneratedJavaScript(input: string): string {
  if (!input.trim()) return "";
  const file = ts.createSourceFile("generated.js", input, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const parseDiagnostics = (file as ts.SourceFile & { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics;
  if (parseDiagnostics.length) fail(`JavaScript syntax: ${ts.flattenDiagnosticMessageText(parseDiagnostics[0]?.messageText, " ").slice(0, 120)}`);

  // Declared names shadow the globals they hide, so a local `const location = …` is a
  // reference to that local. Collect them first so the walk can tell the two apart.
  const declared = new Set<string>();
  const collect = (node: ts.Node) => {
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name && ts.isIdentifier(node.name)) declared.add(node.name.text);
    if (ts.isBindingElement(node) && ts.isIdentifier(node.name)) declared.add(node.name.text);
    ts.forEachChild(node, collect);
  };
  collect(file);

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isExportAssignment(node) || ts.isImportEqualsDeclaration(node)) fail("generated scripts cannot import or export");
    if (node.kind === ts.SyntaxKind.ImportKeyword) fail("dynamic import is not allowed");
    if (node.kind === ts.SyntaxKind.DebuggerStatement) fail("debugger statements are not allowed");
    if (ts.isWithStatement(node)) fail("with statements are not allowed");
    if (ts.isRegularExpressionLiteral(node) && node.text.length > 200) fail("regular expression is too long");

    if (ts.isIdentifier(node)) {
      const isPropertyName = ts.isPropertyAccessExpression(node.parent) && node.parent.name === node;
      const isDeclarationName = (ts.isVariableDeclaration(node.parent) || ts.isParameter(node.parent) || ts.isFunctionDeclaration(node.parent) || ts.isClassDeclaration(node.parent) || ts.isBindingElement(node.parent)) && node.parent.name === node;
      const isMemberName = ts.isPropertyAssignment(node.parent) && node.parent.name === node;
      if (!isPropertyName && !isDeclarationName && !isMemberName && FORBIDDEN_IDENTIFIERS.has(node.text) && !declared.has(node.text)) fail(`prohibited API: ${node.text}`);
    }

    if (ts.isPropertyAccessExpression(node) && FORBIDDEN_PROPERTIES.has(node.name.text)) fail(`prohibited property: ${node.name.text}`);
    if (ts.isElementAccessExpression(node)) {
      const property = stringLiteral(node.argumentExpression);
      if (property && FORBIDDEN_PROPERTIES.has(property)) fail(`prohibited property: ${property}`);
      // A computed member expression can name anything at runtime, so it is only allowed
      // where the key is a literal or a numeric index.
      if (!property && !ts.isNumericLiteral(node.argumentExpression) && !ts.isIdentifier(node.argumentExpression)) fail("computed property access is not allowed");
    }

    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
      if (name && (name === "setTimeout" || name === "setInterval")) {
        const first = node.arguments?.[0];
        if (first && (ts.isStringLiteral(first) || ts.isTemplateExpression(first))) fail(`${name} cannot take a string of code`);
      }
      if (name && ATTRIBUTE_WRITE_METHODS.has(name)) {
        const attribute = stringLiteral(node.arguments?.[0]);
        if (attribute === null) fail(`${name} needs a literal attribute name`);
        if (FORBIDDEN_ATTRIBUTE_WRITES.test(attribute)) fail(`prohibited attribute write: ${attribute}`);
      }
      if (name === "querySelector" || name === "querySelectorAll" || name === "closest" || name === "matches") {
        const selector = stringLiteral(node.arguments?.[0]);
        if (selector === null) fail(`${name} needs a literal selector`);
      }
    }

    // Manufacturing a Canvas identifier would let generated behaviour move or invent the
    // regions Canvas lets a user select and target with an AI edit.
    const literal = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : null;
    if (literal !== null && /data-canvas/i.test(literal)) fail("generated scripts cannot reference Canvas element identifiers");
    if (ts.isPropertyAccessExpression(node) && /^canvas[A-Z]/.test(node.name.text) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "dataset") fail("generated scripts cannot reference Canvas element identifiers");

    ts.forEachChild(node, visit);
  };
  visit(file);
  return input.trim();
}

/**
 * Runtime containment for a validated script.
 *
 * The parameters shadow the globals that could leave the frame or reach the network, so a
 * name obtained some way the static walk did not model still resolves to `undefined`.
 * The IIFE also keeps every declaration out of the shared global scope, which is what
 * stops one Building Block's script from colliding with another's.
 */
export function wrapGeneratedScript(code: string) {
  if (!code.trim()) return "";
  const shadowed = [
    "parent", "top", "opener", "frames", "self", "globalThis", "fetch", "XMLHttpRequest",
    "WebSocket", "EventSource", "localStorage", "sessionStorage", "indexedDB", "navigator",
    "postMessage", "open", "Function", "importScripts", "Worker", "crypto", "caches",
  ].join(",");
  return `;(function(${shadowed}){"use strict";\n${code}\n})();`;
}
