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

describe("Page generation prompt", () => {
  it("supplies project theme context and requires the shared token-backed vocabulary", () => {
    const request = assemblePageGenerationRequest({ context, userRequest: "Create a home page", currentSource: null, imageParts: [] });
    expect(request.structuredContext).toMatchObject({ theme: context.theme });
    expect(request.systemInstructions).toContain("Canvas's controlled runtime classes already apply the current project theme tokens");
    expect(request.systemInstructions).toContain("c-surface");
    expect(request.systemInstructions).toContain("c-logo for a brand mark");
    expect(request.systemInstructions).toContain("browser defaults never determine its appearance");
    expect(request.systemInstructions).toContain("update automatically when that theme changes");
    expect(request.systemInstructions).toContain("^[a-z0-9][a-z0-9-]{0,63}$");
    expect(request.systemInstructions).toContain("Never use a variable, index, property access, template literal");
    expect(request.systemInstructions).toContain("Do not assign it to every DOM element");
    expect(request.systemInstructions).toContain("keep every existing data-canvas-id unchanged");
  });
});
