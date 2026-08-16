import { describe, expect, it } from "vitest";
import { blockKindLabel, blockKindSchema, blockNameSchema, createBlockSchema } from "./schemas";
import { duplicateBlockManifest, duplicateBlockName, uniqueBlockName } from "./duplication";

const projectId = "11111111-1111-4111-8111-111111111111";

describe("Building Block metadata validation", () => {
  it("trims names and rejects blank or oversized names", () => {
    expect(blockNameSchema.parse("  Global Navbar  ")).toBe("Global Navbar");
    expect(() => blockNameSchema.parse("   ")).toThrow();
    expect(() => blockNameSchema.parse("n".repeat(121))).toThrow();
  });

  it("normalizes kinds and rejects unsafe category slugs", () => {
    expect(blockKindSchema.parse(" Navbar ")).toBe("navbar");
    expect(blockKindSchema.parse("product_card")).toBe("product_card");
    for (const invalid of ["9hero", "drop table", "hero-section", "hero;", ""]) expect(() => blockKindSchema.parse(invalid)).toThrow();
  });

  it("defaults new blocks to a private custom block", () => {
    expect(createBlockSchema.parse({ projectId, name: "Hero" })).toMatchObject({ kind: "custom", isGlobal: false });
  });

  it("labels known and unknown kinds without technical jargon", () => {
    expect(blockKindLabel("navbar")).toBe("Navbar");
    expect(blockKindLabel("product_card")).toBe("Product Card");
  });
});

describe("Building Block duplication", () => {
  it("picks the first non-conflicting copy name", () => {
    expect(duplicateBlockName("Global Navbar", [])).toBe("Global Navbar Copy");
    expect(duplicateBlockName("Global Navbar", ["Global Navbar", "Global Navbar Copy"])).toBe("Global Navbar Copy 2");
    expect(duplicateBlockName("Global Navbar", ["global navbar copy", "Global Navbar Copy 2"])).toBe("Global Navbar Copy 3");
  });

  it("copies safe manifest data and never carries the source version's usages", () => {
    const copied = duplicateBlockManifest({ sourceHash: "a".repeat(64), referencedMediaIds: ["11111111-1111-4111-8111-111111111111"], internalRoutes: ["/contact"], usesClientInteractivity: true, blockUsages: [{ blockId: "x", usageKey: "y" }] });
    expect(copied).toMatchObject({ referencedMediaIds: ["11111111-1111-4111-8111-111111111111"], internalRoutes: ["/contact"], usesClientInteractivity: true, blockUsages: [] });
  });
});

/**
 * A section installed from the Canvas library is not a duplicate of anything the project
 * has, so it keeps its own name. Duplicating an existing block still says Copy.
 */
describe("naming a new block", () => {
  it("uses the plain name when it is free, then a numeric suffix", () => {
    expect(uniqueBlockName("Classic bar", [])).toBe("Classic bar");
    expect(uniqueBlockName("Classic bar", ["Classic bar"])).toBe("Classic bar 2");
    expect(uniqueBlockName("Classic bar", ["classic bar", "Classic bar 2"])).toBe("Classic bar 3");
  });

  it("still says Copy when something really is a duplicate", () => {
    expect(duplicateBlockName("Classic bar", [])).toBe("Classic bar Copy");
  });
});
