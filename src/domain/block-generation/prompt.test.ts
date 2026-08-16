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

const generate = () => assembleBlockGenerationRequest({
  context,
  userRequest: "Create a navbar",
  currentDocument: null,
  block: { name: "Global Navbar", kind: "navbar", isGlobal: true },
  imageParts: [],
});

describe("Building Block generation prompt", () => {
  it("makes the markup, style, and script contract explicit in both instructions and schema", () => {
    const request = generate();
    expect(request.systemInstructions).toContain("No style attributes and no on* handlers — behaviour lives in js");
    expect(request.systemInstructions).toContain("re-read the complete html, css, and js once against the hard contract");
    const schema = request.responseSchema as { properties: { html: { description: string }; css: { description: string }; js: { description: string } } };
    expect(schema.properties.html.description).toContain("No <html>, <head>, <body>, <style>, <script>");
    expect(schema.properties.css.description).toContain("No @import, no url()");
    expect(schema.properties.js.description).toContain("no eval or new Function");
  });

  it("requires the shared token-backed navbar and logo vocabulary", () => {
    const request = generate();
    expect(request.structuredContext).toMatchObject({ theme: context.theme });
    expect(request.systemInstructions).toContain("c-navbar");
    expect(request.systemInstructions).toContain("c-nav-brand wrapping a c-logo image");
    expect(request.systemInstructions).toContain("update automatically when that theme changes");
  });

  it("keeps the editable-region contract intact", () => {
    const instructions = generate().systemInstructions;
    expect(instructions).toContain("^[a-z0-9][a-z0-9-]{0,63}$");
    expect(instructions).toContain("Every document needs at least one");
    expect(instructions).toContain("Never tag every element, a trivial wrapper");
    expect(instructions).toContain("Nothing in js may read, write, or construct a data-canvas attribute");
    expect(instructions).toContain("keep every existing data-canvas-id on every region that survives");
  });

  // A block shares the page's craft brief so a generated section never looks like it came
  // from a different design system than the page hosting it.
  it("shares the page craft brief but scopes the section count to one block", () => {
    const instructions = generate().systemInstructions;
    expect(instructions).toContain("Composition patterns");
    expect(instructions).toContain("Placeholder text is a defect");
    expect(instructions).toContain("the page-level \"5 to 8 sections\" target does not apply");
    expect(instructions).toContain("Never use a data-canvas-block host inside block html");
  });

  it("tells the model that Canvas scopes a block's styles and ids when it is composed", () => {
    expect(generate().systemInstructions).toContain("scoped to that block when Canvas composes it onto a page");
  });

  it("re-anchors the user request after the project context", () => {
    expect(generate().systemInstructions.trimEnd().endsWith("Build what was asked for.")).toBe(true);
  });

  it("budgets enough output for a full block alongside provider reasoning", () => {
    const request = generate();
    expect(request.maxOutputTokens).toBeGreaterThanOrEqual(32_000);
    expect(request.reasoningBudget!).toBeGreaterThan(0);
    expect(request.reasoningBudget!).toBeLessThan(request.maxOutputTokens!);
  });
});
