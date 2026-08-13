import { describe, expect, it } from "vitest";
import type { ProjectAIContext } from "@/domain/ai/context";
import { assemblePageGenerationRequest } from "./prompt";

const context = {
  project: { id: "11111111-1111-4111-8111-111111111111", name: "Site", description: null },
  brand: {},
  theme: { light: { primary: "#123456" }, resolved: { colors: { light: { primary: "#123456" } } } },
  structure: { homepage: "22222222-2222-4222-8222-222222222222", pages: [] },
  target: { id: "22222222-2222-4222-8222-222222222222", name: "Home", route: "/" },
  blocks: [], media: [], conversation: [], instructions: { content: "", revisionId: null, revisionNumber: 0 },
  constraints: {}, fingerprint: "a".repeat(64), operation: "page_generate", composition: {},
} as unknown as ProjectAIContext;

const generate = () => assemblePageGenerationRequest({ context, userRequest: "Create a home page", currentSource: null, imageParts: [] });

describe("Page generation prompt", () => {
  it("supplies project theme context and requires the shared token-backed vocabulary", () => {
    const request = generate();
    expect(request.structuredContext).toMatchObject({ theme: context.theme });
    expect(request.systemInstructions).toContain("c-surface");
    expect(request.systemInstructions).toContain("c-logo for a brand mark");
    expect(request.systemInstructions).toContain("browser defaults never decide appearance");
    expect(request.systemInstructions).toContain("update automatically when that theme changes");
  });

  it("forbids escaping the class system through CSS, inline style, or invented utilities", () => {
    const instructions = generate().systemInstructions;
    expect(instructions).toContain("No invented utilities, no dynamic or conditional className, no style attribute");
    expect(instructions).toContain("no CSS variables, no hard-coded theme hex values");
    expect(instructions).toContain("No CSS, font, script, or dynamic imports");
  });

  it("keeps the editable-region contract intact", () => {
    const instructions = generate().systemInstructions;
    expect(instructions).toContain("^[a-z0-9][a-z0-9-]{0,63}$");
    expect(instructions).toContain("Never a variable, index, property access, template literal");
    expect(instructions).toContain("Never tag every element, a trivial wrapper");
    expect(instructions).toContain("keep every existing data-canvas-id on every region that survives");
  });

  // The design standard is the difference between a valid page and a finished one, so it
  // is asserted rather than left to drift out of the prompt unnoticed.
  it("carries the design and copy standard that keeps output off the template default", () => {
    const instructions = generate().systemInstructions;
    expect(instructions).toContain("A substantial page (home, product, services, about) needs 5 to 8 sections");
    expect(instructions).toContain("Never place two structurally identical sections next to each other");
    expect(instructions).toContain("Exactly one h1 per page");
    expect(instructions).toContain("Placeholder text is a defect");
    expect(instructions).toContain("Lorem ipsum");
    expect(instructions).toContain("Composition patterns");
  });

  it("re-anchors the user request after the project context", () => {
    const instructions = generate().systemInstructions;
    expect(instructions.trimEnd().endsWith("Build what was asked for.")).toBe(true);
  });

  it("budgets enough output for a full page alongside provider reasoning", () => {
    const fresh = generate();
    expect(fresh.maxOutputTokens).toBeGreaterThanOrEqual(32_000);
    expect(fresh.reasoningBudget).toBeGreaterThan(0);
    expect(fresh.reasoningBudget!).toBeLessThan(fresh.maxOutputTokens!);

    // A targeted element edit is a small, precise change: less reasoning, low temperature.
    const targeted = assemblePageGenerationRequest({
      context, userRequest: "Change the heading", currentSource: "export default function Page() { return null; }",
      selectedElement: { canvasId: "hero", ownerType: "page" } as never, imageParts: [],
    });
    expect(targeted.reasoningBudget!).toBeLessThan(fresh.reasoningBudget!);
    expect(targeted.temperature).toBeLessThan(fresh.temperature!);
  });
});
