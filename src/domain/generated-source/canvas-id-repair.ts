import { CANVAS_ID_PATTERN } from "./limits";
import { attributeValue, parseHtmlFragment, serializeHtml, setAttribute, walkElements } from "./html/parser";

export type CanvasIdRepair = { from: string; to: string };

function normalizedCanvasId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64).replace(/-+$/g, "");
}

/**
 * Repairs cosmetically malformed Canvas element IDs before validation rejects them.
 *
 * Models reliably produce IDs that mean the right thing but are spelled wrong for the
 * contract — `Hero_Section`, `pricing card 1`. Failing a whole generation over that wastes
 * a paid request, so a one-to-one normalization is applied first. Anything ambiguous is
 * left exactly as it was so the validator rejects it with an explicit diagnostic: a
 * duplicate source value or a collision after normalizing could silently move which
 * region a stored selection points at.
 */
export function repairGeneratedCanvasIds(html: string): { html: string; repairs: CanvasIdRepair[] } {
  let nodes;
  try { nodes = parseHtmlFragment(html); } catch { return { html, repairs: [] }; }

  const targets: Array<{ element: Parameters<Parameters<typeof walkElements>[1]>[0]; value: string }> = [];
  walkElements(nodes, (element) => {
    const value = attributeValue(element, "data-canvas-id");
    if (value !== null) targets.push({ element, value });
  });
  if (!targets.length) return { html, repairs: [] };

  const raw = targets.map(({ value }) => value);
  if (new Set(raw).size !== raw.length) return { html, repairs: [] };
  const normalized = raw.map((value) => (CANVAS_ID_PATTERN.test(value) ? value : normalizedCanvasId(value)));
  if (normalized.some((value) => !CANVAS_ID_PATTERN.test(value)) || new Set(normalized).size !== normalized.length) return { html, repairs: [] };

  const repairs: CanvasIdRepair[] = [];
  targets.forEach(({ element, value }, index) => {
    const replacement = normalized[index]!;
    if (replacement === value) return;
    setAttribute(element, "data-canvas-id", replacement);
    repairs.push({ from: value, to: replacement });
  });
  return repairs.length ? { html: serializeHtml(nodes), repairs } : { html, repairs: [] };
}
