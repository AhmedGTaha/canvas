import { AIError } from "@/domain/ai/provider";
import type { PageDesignPlan, PageDesignPlanBundle } from "./design-plan";

/**
 * Deterministic composition fingerprint, computed server-side from a validated
 * PageDesignPlan. It represents *structural* decisions only — never theme colours, fonts,
 * radius, shadows, or the global navbar/footer Building Blocks, which are visual continuity
 * rather than page composition. Two pages on the same Theme can therefore share a visual
 * language without being forced into the same section sequence, and two pages that reuse
 * the same global furniture are not flagged as duplicates for that reason alone.
 */

export const COMPOSITION_FINGERPRINT_VERSION = 1 as const;

/**
 * The single tunable that decides when two pages in one project are "the same skeleton".
 * Centralised here with a test so the number never gets scattered across the codebase.
 */
export const MAX_ACCEPTABLE_PAGE_COMPOSITION_SIMILARITY = 0.86;

export type CompositionFingerprint = {
  version: typeof COMPOSITION_FINGERPRINT_VERSION;
  sectionCount: number;
  sectionRoles: string[];
  widthSequence: string[];
  alignmentSequence: string[];
  densitySequence: string[];
  mediaEmphasisSequence: string[];
  repetitionSequence: string[];
};

function normalizeRole(role: string): string {
  return role.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).slice(0, 4).join(" ");
}

export function compositionFingerprintFrom(plan: PageDesignPlan): CompositionFingerprint {
  const sections = plan.sections;
  return {
    version: COMPOSITION_FINGERPRINT_VERSION,
    sectionCount: sections.length,
    sectionRoles: sections.map((section) => normalizeRole(section.role)),
    widthSequence: sections.map((section) => section.structuralTraits.widthTreatment),
    alignmentSequence: sections.map((section) => section.structuralTraits.alignment),
    densitySequence: sections.map((section) => section.structuralTraits.density),
    mediaEmphasisSequence: sections.map((section) => section.structuralTraits.mediaEmphasis),
    // Repetition and approximate column count travel together as one structural token.
    repetitionSequence: sections.map((section) => `${section.structuralTraits.repetition}:${section.structuralTraits.approximateColumns ?? "n"}`),
  };
}

/**
 * Order-aware sequence similarity via longest common subsequence: 2·LCS / (|a| + |b|).
 * Returns 1 for two identical sequences and 0 for two with nothing in common, and is
 * sensitive to order rather than to set overlap alone.
 */
export function sequenceSimilarity(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table = new Array(rows * cols).fill(0) as number[];
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      table[i * cols + j] = a[i - 1] === b[j - 1]
        ? table[(i - 1) * cols + (j - 1)]! + 1
        : Math.max(table[(i - 1) * cols + j]!, table[i * cols + (j - 1)]!);
    }
  }
  const lcs = table[a.length * cols + b.length]!;
  return (2 * lcs) / (a.length + b.length);
}

const WEIGHTS = {
  role: 0.3,
  width: 0.2,
  alignment: 0.15,
  density: 0.15,
  media: 0.1,
  repetition: 0.1,
} as const;

/** Deterministic weighted similarity between two composition fingerprints, in [0, 1]. */
export function compositionSimilarity(a: CompositionFingerprint, b: CompositionFingerprint): number {
  const score =
    WEIGHTS.role * sequenceSimilarity(a.sectionRoles, b.sectionRoles) +
    WEIGHTS.width * sequenceSimilarity(a.widthSequence, b.widthSequence) +
    WEIGHTS.alignment * sequenceSimilarity(a.alignmentSequence, b.alignmentSequence) +
    WEIGHTS.density * sequenceSimilarity(a.densitySequence, b.densitySequence) +
    WEIGHTS.media * sequenceSimilarity(a.mediaEmphasisSequence, b.mediaEmphasisSequence) +
    WEIGHTS.repetition * sequenceSimilarity(a.repetitionSequence, b.repetitionSequence);
  return Math.round(score * 1000) / 1000;
}

export type SimilarityMatch = { score: number; fingerprint: CompositionFingerprint } | null;

/** The most similar existing fingerprint to `target`, or null when there is nothing to compare. */
export function mostSimilar(target: CompositionFingerprint, others: readonly CompositionFingerprint[]): SimilarityMatch {
  let best: SimilarityMatch = null;
  for (const other of others) {
    const score = compositionSimilarity(target, other);
    if (!best || score > best.score) best = { score, fingerprint: other };
  }
  return best;
}

/** True when the selected plan is too close to an existing project page's composition. */
export function isTooSimilar(target: CompositionFingerprint, others: readonly CompositionFingerprint[]): boolean {
  const match = mostSimilar(target, others);
  return match !== null && match.score >= MAX_ACCEPTABLE_PAGE_COMPOSITION_SIMILARITY;
}

/**
 * Verifies the three candidate plans in a bundle are meaningfully distinct from one
 * another. A planner that returns three near-duplicates has produced no real diversity, so
 * the bundle is rejected with a repairable AIError.
 */
export function assertCandidateDiversity(bundle: PageDesignPlanBundle): void {
  const fingerprints = bundle.candidates.map(compositionFingerprintFrom);
  for (let i = 0; i < fingerprints.length; i += 1) {
    for (let j = i + 1; j < fingerprints.length; j += 1) {
      if (compositionSimilarity(fingerprints[i]!, fingerprints[j]!) >= MAX_ACCEPTABLE_PAGE_COMPOSITION_SIMILARITY) {
        throw new AIError(
          "AI_DESIGN_PLAN_INVALID",
          "Canvas could not produce a usable design plan for this page. Try again.",
          false, undefined,
          `candidate plans ${i} and ${j} are near-duplicates`,
        );
      }
    }
  }
}
