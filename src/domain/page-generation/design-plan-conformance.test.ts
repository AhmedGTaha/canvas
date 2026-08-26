import { describe, expect, it } from "vitest";
import { checkDesignPlanConformance } from "./design-plan-conformance";
import type { PageDesignPlan } from "./design-plan";
import type { GeneratedPageManifest } from "./validator";

function section(id: string, mediaEmphasis: PageDesignPlan["sections"][number]["structuralTraits"]["mediaEmphasis"]): PageDesignPlan["sections"][number] {
  return {
    id, role: "role", contentGoal: "goal", composition: "composition", focalPoint: "focus", responsiveBehavior: "stacks", mediaRole: null,
    structuralTraits: { widthTreatment: "contained", alignment: "left", density: "balanced", mediaEmphasis, repetition: "none", approximateColumns: null },
  };
}
function plan(sections: PageDesignPlan["sections"]): PageDesignPlan {
  return {
    id: "p", pageIntent: { primaryGoal: "goal", audience: "a", desiredAction: null },
    artDirection: { concept: "c", mood: "m", visualMotifs: [], densityRhythm: "r", mediaStrategy: "s" },
    sections, responsiveStrategy: "mobile first", continuity: { sharedSiteLanguage: [], deliberatePageDifferences: [] }, originalityRationale: "because",
  };
}
function manifest(overrides: Partial<GeneratedPageManifest>): GeneratedPageManifest {
  return {
    schemaVersion: 1, sourceHash: "h", referencedMediaIds: [], internalRoutes: [], externalLinks: [],
    usesClientInteractivity: false, runtimeVersion: 2, blockUsages: [],
    editableElements: [{ canvasId: "hero", elementType: "section", label: null }], elementIds: [], ...overrides,
  };
}

describe("design-plan conformance", () => {
  it("fails when the plan demands dominant Media but the document references none", () => {
    const result = checkDesignPlanConformance(plan([section("a", "dominant")]), manifest({ referencedMediaIds: [] }));
    expect(result.ok).toBe(false);
  });

  it("passes when dominant Media is present", () => {
    const result = checkDesignPlanConformance(plan([section("a", "dominant")]), manifest({ referencedMediaIds: ["00000000-0000-4000-8000-000000000000"] }));
    expect(result.ok).toBe(true);
  });

  it("fails when a multi-section plan collapses to a single selectable region", () => {
    const four = plan([section("a", "none"), section("b", "none"), section("c", "none"), section("d", "none")]);
    const result = checkDesignPlanConformance(four, manifest({ editableElements: [{ canvasId: "only", elementType: "main", label: null }] }));
    expect(result.ok).toBe(false);
  });

  it("does not reject a small plan with modest region counts", () => {
    const two = plan([section("a", "supporting"), section("b", "none")]);
    expect(checkDesignPlanConformance(two, manifest({ editableElements: [{ canvasId: "one", elementType: "section", label: null }] })).ok).toBe(true);
  });
});
