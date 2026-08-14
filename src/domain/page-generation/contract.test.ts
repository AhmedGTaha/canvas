import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { blockChangeSummarySchema } from "@/domain/block-generation/contract";
import { generatedPageResponseSchema, pageChangeSummarySchema } from "./contract";

const mediaId = "11111111-1111-4111-8111-111111111111";

function summary(overrides: Partial<{ headline: string; changes: string[]; limitations: string[] }> = {}) {
  return { headline: "Rebuilt the hero section.", changes: ["Replaced the headline copy."], limitations: [], ...overrides };
}

function pageResponse(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    sourceCode: `export default function Page(){return <main/>}`,
    referencedMediaIds: [],
    summary: summary(),
    ...overrides,
  };
}

describe("change summary normalization", () => {
  it("clamps an over-length headline to 120 characters instead of rejecting the response", () => {
    const parsed = pageChangeSummarySchema.parse(summary({ headline: "H".repeat(180) }));
    expect(parsed.headline).toBe("H".repeat(120));
  });

  it("clamps an over-length limitations entry to 200 characters", () => {
    const parsed = pageChangeSummarySchema.parse(summary({ limitations: ["L".repeat(260)] }));
    expect(parsed.limitations[0]).toBe("L".repeat(200));
  });

  it("clamps an over-length changes entry to 200 characters", () => {
    const parsed = pageChangeSummarySchema.parse(summary({ changes: ["C".repeat(240)] }));
    expect(parsed.changes[0]).toBe("C".repeat(200));
  });

  it("collapses whitespace in the headline before clamping", () => {
    const parsed = pageChangeSummarySchema.parse(summary({ headline: "  Rebuilt   the\n hero  section.  " }));
    expect(parsed.headline).toBe("Rebuilt the hero section.");
  });

  it("clamps a headline that only exceeds 120 characters once whitespace is counted", () => {
    const parsed = pageChangeSummarySchema.parse(summary({ headline: `${"H".repeat(118)}   tail` }));
    expect(parsed.headline).toBe(`${"H".repeat(118)} t`);
  });

  it("drops array entries that are empty after trimming", () => {
    const parsed = pageChangeSummarySchema.parse(summary({ changes: ["Replaced the copy.", "   ", ""], limitations: ["  "] }));
    expect(parsed.changes).toEqual(["Replaced the copy."]);
    expect(parsed.limitations).toEqual([]);
  });

  it("leaves compliant summary values unchanged", () => {
    const compliant = summary({ headline: "Rebuilt the hero section.", changes: ["Replaced the headline copy."], limitations: ["Contact form is not wired up."] });
    expect(pageChangeSummarySchema.parse(compliant)).toEqual(compliant);
  });

  it("still rejects a headline that is empty after trimming", () => {
    expect(() => pageChangeSummarySchema.parse(summary({ headline: "   " }))).toThrow();
  });

  it("still rejects more than 6 changes", () => {
    expect(() => pageChangeSummarySchema.parse(summary({ changes: Array.from({ length: 7 }, (_, index) => `Change ${index}.`) }))).toThrow();
  });

  it("still rejects more than 4 limitations", () => {
    expect(() => pageChangeSummarySchema.parse(summary({ limitations: Array.from({ length: 5 }, (_, index) => `Limitation ${index}.`) }))).toThrow();
  });

  it("counts entries dropped as empty against neither array limit", () => {
    const changes = [...Array.from({ length: 6 }, (_, index) => `Change ${index}.`), "   "];
    expect(pageChangeSummarySchema.parse(summary({ changes })).changes).toHaveLength(6);
  });

  it("applies the same normalization to block generation", () => {
    const parsed = blockChangeSummarySchema.parse(summary({ headline: "B".repeat(150), limitations: ["L".repeat(210)] }));
    expect(parsed.headline).toBe("B".repeat(120));
    expect(parsed.limitations[0]).toBe("L".repeat(200));
  });
});

describe("generated page response strictness", () => {
  it("accepts a response whose only defect is an over-length summary", () => {
    const parsed = generatedPageResponseSchema.parse(pageResponse({ summary: summary({ limitations: ["L".repeat(260)] }) }));
    expect(parsed.summary.limitations[0]).toHaveLength(200);
    expect(parsed.sourceCode).toBe(`export default function Page(){return <main/>}`);
  });

  it("keeps rejecting an over-size sourceCode", () => {
    expect(() => generatedPageResponseSchema.parse(pageResponse({ sourceCode: "x".repeat(102_401) }))).toThrow();
  });

  it("drops a non-UUID media reference instead of failing the whole response", () => {
    const parsed = generatedPageResponseSchema.parse(pageResponse({ referencedMediaIds: [mediaId, "not-a-uuid"] }));
    expect(parsed.referencedMediaIds).toEqual([mediaId]);
  });

  it("keeps rejecting more media references than the contract allows", () => {
    const ids = Array.from({ length: 21 }, () => randomUUID());
    expect(() => generatedPageResponseSchema.parse(pageResponse({ referencedMediaIds: ids }))).toThrow();
  });

  it("keeps rejecting a malformed block usage key", () => {
    expect(() => generatedPageResponseSchema.parse(pageResponse({ blockUsages: [{ blockId: mediaId, usageKey: "Not Valid" }] }))).toThrow();
  });

  it("keeps rejecting an over-length targetCanvasId", () => {
    expect(() => generatedPageResponseSchema.parse(pageResponse({ targetCanvasId: "a".repeat(65) }))).toThrow();
  });

  it("keeps rejecting unknown top-level properties", () => {
    expect(() => generatedPageResponseSchema.parse(pageResponse({ unexpected: true }))).toThrow();
  });
});
