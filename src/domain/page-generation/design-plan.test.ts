import { describe, expect, it } from "vitest";
import { AIError } from "@/domain/ai/provider";
import {
  DESIGN_PLAN_SCHEMA_VERSION,
  pageDesignPlanSchema,
  pageDesignPlanBundleSchema,
  persistedDesignPlanFrom,
  validatePageDesignPlanBundle,
  type PageDesignPlan,
} from "./design-plan";

function section(id: string, overrides: Partial<PageDesignPlan["sections"][number]["structuralTraits"]> = {}): PageDesignPlan["sections"][number] {
  return {
    id, role: `role-${id}`, contentGoal: "make the visitor act", composition: `a distinctive composition for ${id}`,
    focalPoint: "the headline", responsiveBehavior: "stacks on mobile", mediaRole: null,
    structuralTraits: { widthTreatment: "contained", alignment: "left", density: "balanced", mediaEmphasis: "none", repetition: "none", approximateColumns: null, ...overrides },
  };
}

function plan(id: string, sectionIds: string[]): PageDesignPlan {
  return {
    id,
    pageIntent: { primaryGoal: "convert visitors", audience: "small businesses", desiredAction: "book a call" },
    artDirection: { concept: "editorial", mood: "confident", visualMotifs: ["grid"], densityRhythm: "alternating", mediaStrategy: "supporting" },
    sections: sectionIds.map((sectionId) => section(sectionId)),
    responsiveStrategy: "mobile first",
    continuity: { sharedSiteLanguage: ["navbar"], deliberatePageDifferences: ["opening"] },
    originalityRationale: "the opening leads with the offer, not a generic hero",
  };
}

const bundle = (selectedId: string) => ({
  schemaVersion: DESIGN_PLAN_SCHEMA_VERSION,
  candidates: [plan("a", ["s1", "s2"]), plan("b", ["s1", "s2", "s3"]), plan("c", ["s1"])],
  selectedCandidateId: selectedId,
  selectionRationale: "candidate b fits the page best",
});

describe("PageDesignPlan schema", () => {
  it("accepts a well-formed plan and rejects an unknown structural trait", () => {
    expect(pageDesignPlanSchema.safeParse(plan("a", ["s1", "s2"])).success).toBe(true);
    const broken = plan("a", ["s1"]);
    (broken.sections[0]!.structuralTraits as { density: string }).density = "cramped";
    expect(pageDesignPlanSchema.safeParse(broken).success).toBe(false);
  });

  it("requires at least one section", () => {
    const empty = { ...plan("a", ["s1"]), sections: [] };
    expect(pageDesignPlanSchema.safeParse(empty).success).toBe(false);
  });
});

describe("PageDesignPlanBundle validation", () => {
  it("requires exactly three candidates", () => {
    const two = { ...bundle("a"), candidates: bundle("a").candidates.slice(0, 2) };
    expect(pageDesignPlanBundleSchema.safeParse(two).success).toBe(false);
  });

  it("requires selectedCandidateId to name a candidate", () => {
    expect(pageDesignPlanBundleSchema.safeParse(bundle("does-not-exist")).success).toBe(false);
    expect(pageDesignPlanBundleSchema.safeParse(bundle("b")).success).toBe(true);
  });

  it("returns the selected plan from a valid bundle", () => {
    const { selected } = validatePageDesignPlanBundle(bundle("b"));
    expect(selected.id).toBe("b");
  });

  it("raises a design-plan AIError on an invalid bundle rather than throwing a raw Zod error", () => {
    try {
      validatePageDesignPlanBundle({ nonsense: true });
      throw new Error("expected validation to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AIError);
      expect((error as AIError).code).toBe("AI_DESIGN_PLAN_INVALID");
    }
  });
});

describe("persisted design-plan metadata", () => {
  it("carries page intent, section roles, and the fingerprint but no prompt content", () => {
    const persisted = persistedDesignPlanFrom(plan("a", ["s1", "s2"]), { version: 1 });
    expect(persisted.schemaVersion).toBe(DESIGN_PLAN_SCHEMA_VERSION);
    expect(persisted.pageIntent).toBe("convert visitors");
    expect(persisted.sectionRoles).toEqual(["role-s1", "role-s2"]);
    expect(persisted.compositionFingerprint).toEqual({ version: 1 });
  });
});
