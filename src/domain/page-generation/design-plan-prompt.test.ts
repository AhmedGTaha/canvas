import { describe, expect, it } from "vitest";
import type { ProjectAIContext } from "@/domain/ai/context";
import { CANVAS_PROMPT_VERSIONS } from "@/domain/ai/prompts/versions";
import { assemblePageDesignPlanRequest, conflictingCompositionNote } from "./design-plan-prompt";
import { pageDesignPlanBundleJsonSchema } from "./design-plan";
import { COMPOSITION_FINGERPRINT_VERSION, type CompositionFingerprint } from "./composition-fingerprint";

const context = {
  project: { id: "11111111-1111-4111-8111-111111111111", name: "Acme Roofing", description: "Flat roof repairs" },
  brand: { companyName: "Acme Roofing" },
  theme: { light: { primary: "#123456" } },
  structure: { homepage: "22222222-2222-4222-8222-222222222222", pages: [{ id: "22222222-2222-4222-8222-222222222222", type: "page", route: "/" }] },
  target: { id: "22222222-2222-4222-8222-222222222222", name: "Home", route: "/" },
  blocks: [], media: [], conversation: [],
  instructions: { content: "Always mention our 24-hour callout.", revisionId: null, revisionNumber: 3 },
  constraints: {}, fingerprint: "a".repeat(64), operation: "page_generate", composition: {},
} as unknown as ProjectAIContext;

const request = (replanNote?: string | null) => assemblePageDesignPlanRequest({ context, userRequest: "Design the home page", imageParts: [], replanNote });

describe("design-planning prompt", () => {
  it("asks for three meaningfully different candidates and a justified selection", () => {
    const instructions = request().systemInstructions;
    expect(instructions).toContain("exactly three candidate design plans");
    expect(instructions).toContain("meaningfully different in hierarchy and composition");
    expect(instructions).toContain("selectedCandidateId");
  });

  it("keeps Theme as visual treatment and composition as this page's decision", () => {
    const instructions = request().systemInstructions;
    expect(instructions).toContain("Theme defines visual treatment only");
    expect(instructions).toContain("never dictates page composition");
    expect(instructions).toContain("invented for this page's specific job");
    expect(instructions).toContain("structuralTraits fields are coarse comparison metadata, not a menu");
  });

  it("runs hotter and cheaper than source generation and stays provider-neutral", () => {
    const built = request();
    expect(built.temperature).toBeGreaterThan(0.6);
    expect(built.maxOutputTokens).toBeLessThan(32_000);
    expect(built.responseSchema).toBe(pageDesignPlanBundleJsonSchema);
    expect(built.requestMetadata?.promptVersion).toBe(CANVAS_PROMPT_VERSIONS.page_design_plan);
    expect(JSON.stringify(built)).not.toMatch(/gemini|openai|anthropic/i);
  });

  it("carries the platform rules and keeps the generated-document format explicit", () => {
    const instructions = request().systemInstructions;
    expect(instructions).toContain("highest precedence");
    expect(instructions).toContain("Never emit React, JSX, TSX, Next.js components");
  });

  it("adds a re-plan conflict note only when one is supplied", () => {
    expect(request().systemInstructions).not.toContain("Composition conflict");
    const fingerprint: CompositionFingerprint = {
      version: COMPOSITION_FINGERPRINT_VERSION, sectionCount: 2, sectionRoles: ["hero opening", "cta"],
      widthSequence: ["full_bleed", "contained"], alignmentSequence: ["center", "center"],
      densitySequence: ["balanced", "compact"], mediaEmphasisSequence: ["dominant", "none"], repetitionSequence: ["none:n", "none:n"],
    };
    const replanned = assemblePageDesignPlanRequest({ context, userRequest: "Design", imageParts: [], replanNote: conflictingCompositionNote(fingerprint, 0.91) });
    expect(replanned.systemInstructions).toContain("Composition conflict");
    expect(replanned.systemInstructions).toContain("hero opening → cta");
    expect(replanned.systemInstructions).toContain("keeping the same Theme, brand, page purpose, and reusable global navbar and footer");
  });
});
