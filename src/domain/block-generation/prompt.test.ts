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
    expect(request.systemInstructions).toContain("Never reference CSS variables directly, write CSS, or add a JSX style attribute.");
    expect(request.systemInstructions).toContain("Never use style={{...}}");
    expect(request.systemInstructions).toContain("remove every style= attribute");
    const schema = request.responseSchema as { properties: { sourceCode: { description: string } } };
    expect(schema.properties.sourceCode.description).toContain("JSX style attributes");
    expect(schema.properties.sourceCode.description).toContain("forbidden");
  });
});
