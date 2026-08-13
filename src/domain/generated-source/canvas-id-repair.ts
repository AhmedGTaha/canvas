import ts from "typescript";
import { CANVAS_ID_PATTERN } from "./limits";

export type CanvasIdRepair = { from: string; to: string };

function staticAttributeValue(attribute: ts.JsxAttribute) {
  const initializer = attribute.initializer;
  if (!initializer) return null;
  if (ts.isStringLiteral(initializer)) return initializer.text;
  if (ts.isJsxExpression(initializer) && initializer.expression && (ts.isStringLiteral(initializer.expression) || ts.isNoSubstitutionTemplateLiteral(initializer.expression))) return initializer.expression.text;
  return null;
}

function normalizedCanvasId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64).replace(/-+$/g, "");
}

/**
 * Repairs only one-to-one malformed static ID literals. Dynamic expressions cannot be
 * mapped to rendered elements safely, and any duplicate/collision leaves source intact
 * so the validator rejects it with an explicit diagnostic.
 */
export function repairGeneratedCanvasIds(sourceCode: string): { sourceCode: string; repairs: CanvasIdRepair[] } {
  const file = ts.createSourceFile("generated.tsx", sourceCode, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const parseDiagnostics = (file as ts.SourceFile & { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics;
  if (parseDiagnostics.length) return { sourceCode, repairs: [] };
  const attributes: Array<{ attribute: ts.JsxAttribute; value: string | null }> = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && node.name.getText(file) === "data-canvas-id") attributes.push({ attribute: node, value: staticAttributeValue(node) });
    ts.forEachChild(node, visit);
  };
  visit(file);
  // A dynamic ID or duplicate source value is inherently ambiguous. Do not partially
  // repair around it because that could change selection ownership unpredictably.
  if (attributes.some(({ value }) => value === null)) return { sourceCode, repairs: [] };
  const raw = attributes.map(({ value }) => value!);
  if (new Set(raw).size !== raw.length) return { sourceCode, repairs: [] };
  const normalized = raw.map((value) => CANVAS_ID_PATTERN.test(value) ? value : normalizedCanvasId(value));
  if (normalized.some((value) => !CANVAS_ID_PATTERN.test(value)) || new Set(normalized).size !== normalized.length) return { sourceCode, repairs: [] };

  const edits = attributes.flatMap(({ attribute, value }, index) => {
    const replacement = normalized[index]!;
    if (replacement === value) return [];
    const initializer = attribute.initializer!;
    return [{ start: initializer.getStart(file), end: initializer.getEnd(), text: JSON.stringify(replacement), from: value!, to: replacement }];
  }).sort((left, right) => right.start - left.start);
  let repaired = sourceCode;
  for (const edit of edits) repaired = repaired.slice(0, edit.start) + edit.text + repaired.slice(edit.end);
  return { sourceCode: repaired, repairs: edits.map(({ from, to }) => ({ from, to })).reverse() };
}
