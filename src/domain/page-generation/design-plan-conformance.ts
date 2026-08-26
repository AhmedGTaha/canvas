import type { PageDesignPlan } from "./design-plan";
import type { GeneratedPageManifest } from "./validator";

/**
 * Output-versus-plan conformance.
 *
 * The similarity gate stops a bad plan; this stops the generated source from ignoring a
 * good one. It uses only deterministic manifest signals and stays deliberately
 * conservative — it never parses CSS for layout intent or rejects creative markup for using
 * unfamiliar class names. It fires only on strong, unambiguous signals that the model
 * discarded the plan wholesale, so legitimate custom output passes. The security validator
 * remains the final authority on what source is allowed.
 */

export type ConformanceResult = { ok: true } | { ok: false; reason: string };

export function checkDesignPlanConformance(plan: PageDesignPlan, manifest: GeneratedPageManifest, options: { mediaAvailable?: boolean } = {}): ConformanceResult {
  // A plan that calls for dominant imagery but produces a document with no Media at all has
  // not implemented the plan. (Supporting/background/none impose no such requirement here.)
  const wantsDominantMedia = plan.sections.some((section) => section.structuralTraits.mediaEmphasis === "dominant");
  // Placeholder-led pages legitimately have no Canvas Media references. Only require
  // dominant imagery when the generation context actually made approved Media available.
  if (wantsDominantMedia && options.mediaAvailable !== false && manifest.referencedMediaIds.length === 0) {
    return { ok: false, reason: "design plan requires dominant Media but the document references none" };
  }
  // A multi-section plan collapsed into a single selectable region is the clearest sign the
  // composition was thrown away. Substantial plans should surface as several editable
  // regions; the bound is intentionally low so ordinary variation is never rejected.
  if (plan.sections.length >= 4 && manifest.editableElements.length < 2) {
    return { ok: false, reason: `design plan has ${plan.sections.length} sections but the document exposes ${manifest.editableElements.length} selectable region(s)` };
  }
  return { ok: true };
}
