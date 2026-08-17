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

const generate = () => assemblePageGenerationRequest({ context, userRequest: "Create a home page", currentDocument: null, imageParts: [] });

describe("Page generation prompt", () => {
  it("supplies project theme context and requires the shared token-backed vocabulary", () => {
    const request = generate();
    expect(request.structuredContext).toMatchObject({ theme: context.theme });
    expect(request.systemInstructions).toContain("c-surface");
    expect(request.systemInstructions).toContain("c-logo on an image that is a brand logo");
    expect(request.systemInstructions).toContain("update automatically when that theme changes");
    expect(request.systemInstructions).toContain("var(--color-primary)");
  });

  it("states the three-artifact contract and what each one may not contain", () => {
    const instructions = generate().systemInstructions;
    expect(instructions).toContain("html is a body fragment");
    expect(instructions).toContain("No style attributes and no on* handlers — behaviour lives in js");
    expect(instructions).toContain("css: no @import, no url(), no @font-face");
    expect(instructions).toContain("js: no imports or exports, no network, no storage");
  });

  it("requires images and reusable sections to go through Canvas rather than through URLs", () => {
    const instructions = generate().systemInstructions;
    expect(instructions).toContain(`<img data-canvas-media="<approved Media UUID>" alt="..."> with no src attribute`);
    expect(instructions).toContain(`<div data-canvas-block="<block UUID>" data-canvas-usage="<stable-page-key>"></div>`);
  });

  it("keeps the editable-region contract intact", () => {
    const instructions = generate().systemInstructions;
    expect(instructions).toContain("^[a-z0-9][a-z0-9-]{0,63}$");
    expect(instructions).toContain("Every document needs at least one");
    expect(instructions).toContain("Never tag every element, a trivial wrapper");
    expect(instructions).toContain("Nothing in js may read, write, or construct a data-canvas attribute");
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
    // How the classes behave, so composition is an informed decision — not a sample page
    // to reproduce, which is what turned the design system into a template.
    expect(instructions).toContain("How the classes behave");
    expect(instructions).toContain("Design system versus composition");
    expect(instructions).not.toContain("Composition patterns");
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
      context, userRequest: "Change the heading",
      currentDocument: { schemaVersion: 1, html: `<main data-canvas-id="hero"><h1>Hi</h1></main>`, css: "", js: "", metadata: null },
      selectedElement: { canvasId: "hero", ownerType: "page" } as never, imageParts: [],
    });
    expect(targeted.reasoningBudget!).toBeLessThan(fresh.reasoningBudget!);
    expect(targeted.temperature).toBeLessThan(fresh.temperature!);
  });
});
