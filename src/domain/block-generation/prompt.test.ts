import { describe, expect, it } from "vitest";
import type { ProjectAIContext } from "@/domain/ai/context";
import { assembleBlockGenerationRequest } from "./prompt";

const context = {
  project: { id: "11111111-1111-4111-8111-111111111111", name: "Site", description: null },
  brand: {}, theme: {}, structure: { homepage: null, pages: [] },
  target: { type: "building_block", id: "22222222-2222-4222-8222-222222222222" },
  blocks: [], media: [], conversation: [], instructions: { content: "", revisionId: null, revisionNumber: 0 },
  constraints: {}, fingerprint: "a".repeat(64), operation: "block_generate", composition: {},
} as unknown as ProjectAIContext;

describe("Building Block generation prompt", () => {
  it("makes the no-inline-style contract explicit in both instructions and structured schema", () => {
    const request = assembleBlockGenerationRequest({
      context,
      userRequest: "Create a navbar",
      currentSource: null,
      block: { name: "Global Navbar", kind: "navbar", isGlobal: true },
      imageParts: [],
    });
    expect(request.systemInstructions).toContain("Never reference CSS variables directly");
    expect(request.systemInstructions).toContain("write CSS, or add a JSX style attribute");
    expect(request.systemInstructions).toContain("Never use style={{...}}");
    expect(request.systemInstructions).toContain("remove every style= attribute");
    const schema = request.responseSchema as { properties: { sourceCode: { description: string } } };
    expect(schema.properties.sourceCode.description).toContain("JSX style attributes");
    expect(schema.properties.sourceCode.description).toContain("forbidden");
  });

  it("requires the shared token-backed navbar and logo vocabulary", () => {
    const request = assembleBlockGenerationRequest({
      context,
      userRequest: "Create a navbar",
      currentSource: null,
      block: { name: "Global Navbar", kind: "navbar", isGlobal: true },
      imageParts: [],
    });
    expect(request.structuredContext).toMatchObject({ theme: context.theme });
    expect(request.systemInstructions).toContain("c-navbar");
    expect(request.systemInstructions).toContain("c-nav-brand with a c-logo CanvasImage");
    expect(request.systemInstructions).toContain("browser defaults never determine its appearance");
    expect(request.systemInstructions).toContain("update automatically when that theme changes");
    expect(request.systemInstructions).toContain("Do not invent utility classes");
    expect(request.systemInstructions).toContain("^[a-z0-9][a-z0-9-]{0,63}$");
    expect(request.systemInstructions).toContain("Never use a variable, index, property access, template literal");
    expect(request.systemInstructions).toContain("Do not assign it to every DOM element");
    expect(request.systemInstructions).toContain("keep every existing data-canvas-id unchanged");
  });
});
