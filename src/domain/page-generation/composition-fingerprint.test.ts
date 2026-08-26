import { describe, expect, it } from "vitest";
import { AIError } from "@/domain/ai/provider";
import {
  COMPOSITION_FINGERPRINT_VERSION,
  MAX_ACCEPTABLE_PAGE_COMPOSITION_SIMILARITY,
  assertCandidateDiversity,
  compositionFingerprintFrom,
  compositionSimilarity,
  isTooSimilar,
  mostSimilar,
  sequenceSimilarity,
} from "./composition-fingerprint";
import { DESIGN_PLAN_SCHEMA_VERSION, type PageDesignPlan, type StructuralTraits } from "./design-plan";

type Traits = Partial<StructuralTraits>;
function section(id: string, role: string, traits: Traits = {}): PageDesignPlan["sections"][number] {
  return {
    id, role, contentGoal: "goal", composition: `composition ${id}`, focalPoint: "focus",
    responsiveBehavior: "stacks", mediaRole: null,
    structuralTraits: { widthTreatment: "contained", alignment: "left", density: "balanced", mediaEmphasis: "none", repetition: "none", approximateColumns: null, ...traits },
  };
}
function plan(id: string, sections: PageDesignPlan["sections"]): PageDesignPlan {
  return {
    id, pageIntent: { primaryGoal: "goal", audience: "audience", desiredAction: null },
    artDirection: { concept: "c", mood: "m", visualMotifs: [], densityRhythm: "r", mediaStrategy: "s" },
    sections, responsiveStrategy: "mobile first",
    continuity: { sharedSiteLanguage: [], deliberatePageDifferences: [] }, originalityRationale: "because",
  };
}

const home = plan("home", [
  section("h1", "hero opening", { widthTreatment: "full_bleed", alignment: "center", mediaEmphasis: "dominant" }),
  section("h2", "service grid", { repetition: "grid", approximateColumns: 3 }),
  section("h3", "testimonial", { density: "airy" }),
  section("h4", "closing cta", { alignment: "center" }),
]);
const services = plan("services", [
  section("s1", "capability list", { repetition: "list" }),
  section("s2", "detailed prose", { density: "compact" }),
  section("s3", "pricing table", { repetition: "table", approximateColumns: 4 }),
]);

describe("composition fingerprint", () => {
  it("is deterministic and structural only — no theme colours, fonts, radius, or shadows", () => {
    const first = compositionFingerprintFrom(home);
    const second = compositionFingerprintFrom(home);
    expect(first).toEqual(second);
    expect(first.version).toBe(COMPOSITION_FINGERPRINT_VERSION);
    const serialized = JSON.stringify(first);
    // No theme value can leak into a fingerprint, because none is read to build one.
    for (const themeWord of ["#", "font", "radius", "shadow", "color", "spacing"]) {
      expect(serialized.toLowerCase()).not.toContain(themeWord);
    }
    expect(Object.keys(first).sort()).toEqual([
      "alignmentSequence", "densitySequence", "mediaEmphasisSequence", "repetitionSequence",
      "sectionCount", "sectionRoles", "version", "widthSequence",
    ]);
  });

  it("does not change when only theme-like art direction differs", () => {
    const recoloured = { ...home, artDirection: { ...home.artDirection, mood: "playful", concept: "brutalist" } };
    expect(compositionFingerprintFrom(recoloured)).toEqual(compositionFingerprintFrom(home));
  });
});

describe("sequence similarity", () => {
  it("is 1 for identical sequences and order-aware", () => {
    expect(sequenceSimilarity(["a", "b", "c"], ["a", "b", "c"])).toBe(1);
    expect(sequenceSimilarity(["a", "b"], ["b", "a"])).toBeLessThan(1);
    expect(sequenceSimilarity([], [])).toBe(1);
    expect(sequenceSimilarity(["a"], [])).toBe(0);
  });
});

describe("composition similarity and threshold", () => {
  it("keeps the threshold in one named constant", () => {
    expect(MAX_ACCEPTABLE_PAGE_COMPOSITION_SIMILARITY).toBeGreaterThan(0);
    expect(MAX_ACCEPTABLE_PAGE_COMPOSITION_SIMILARITY).toBeLessThan(1);
  });

  it("scores an identical composition at 1 and two different pages below the threshold", () => {
    expect(compositionSimilarity(compositionFingerprintFrom(home), compositionFingerprintFrom(home))).toBe(1);
    const score = compositionSimilarity(compositionFingerprintFrom(home), compositionFingerprintFrom(services));
    expect(score).toBeLessThan(MAX_ACCEPTABLE_PAGE_COMPOSITION_SIMILARITY);
  });

  it("flags a same-project page that repeats another page's skeleton", () => {
    // A second page that copies Home's section sequence and traits is too similar.
    const clone = { ...home, id: "about" };
    expect(isTooSimilar(compositionFingerprintFrom(clone), [compositionFingerprintFrom(home)])).toBe(true);
    // Two genuinely different pages are not.
    expect(isTooSimilar(compositionFingerprintFrom(services), [compositionFingerprintFrom(home)])).toBe(false);
  });

  it("returns null when there is nothing to compare against", () => {
    expect(mostSimilar(compositionFingerprintFrom(home), [])).toBeNull();
  });
});

describe("candidate diversity", () => {
  const bundle = (candidates: PageDesignPlan[]) => ({
    schemaVersion: DESIGN_PLAN_SCHEMA_VERSION, candidates: candidates as [PageDesignPlan, PageDesignPlan, PageDesignPlan],
    selectedCandidateId: candidates[0]!.id, selectionRationale: "first",
  });

  it("accepts three structurally distinct candidates", () => {
    expect(() => assertCandidateDiversity(bundle([home, services, plan("c", [section("x", "single statement")])]))).not.toThrow();
  });

  it("rejects three near-identical candidates", () => {
    try {
      assertCandidateDiversity(bundle([home, { ...home, id: "b" }, { ...home, id: "c" }]));
      throw new Error("expected diversity assertion to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AIError);
      expect((error as AIError).code).toBe("AI_DESIGN_PLAN_INVALID");
    }
  });
});
