import { describe, expect, it } from "vitest";
import { describeElement, elementSelectionSchema, findEditableElement, manifestEditableElements, readResolvedSelection } from "./selection";

const manifest = {
  sourceHash: "a".repeat(64),
  editableElements: [
    { canvasId: "hero-main", elementType: "section", label: "Hero" },
    { canvasId: "pricing-card-pro", elementType: "article", label: null },
  ],
};

describe("element selection contract", () => {
  it("accepts well-formed selection metadata and normalizes optional owners", () => {
    expect(elementSelectionSchema.parse({ canvasId: "hero-main" })).toEqual({ canvasId: "hero-main", blockId: null, usageKey: null });
    expect(elementSelectionSchema.parse({ canvasId: "hero-main", blockId: "11111111-1111-4111-8111-111111111111", usageKey: "site-navbar" }))
      .toMatchObject({ blockId: "11111111-1111-4111-8111-111111111111", usageKey: "site-navbar" });
  });

  it("rejects malformed identifiers before they reach any lookup", () => {
    for (const canvasId of ["Hero Main", "hero_main", "-hero", "", "hero/../admin", "h".repeat(65), "<script>"]) {
      expect(elementSelectionSchema.safeParse({ canvasId }).success).toBe(false);
    }
    expect(elementSelectionSchema.safeParse({ canvasId: "hero-main", blockId: "not-a-uuid" }).success).toBe(false);
    expect(elementSelectionSchema.safeParse({ canvasId: "hero-main", extra: "x" }).success).toBe(false);
  });

  it("maps manifests to editable elements and ignores malformed entries", () => {
    expect(manifestEditableElements(manifest)).toHaveLength(2);
    expect(manifestEditableElements({ editableElements: [{ canvasId: "Bad Id" }, { canvasId: "ok-one" }, null, "x"] })).toEqual([{ canvasId: "ok-one", elementType: "element", label: null }]);
    expect(manifestEditableElements(null)).toEqual([]);
    expect(manifestEditableElements({})).toEqual([]);
  });

  it("finds elements by ID and describes them for the composer and prompt", () => {
    expect(findEditableElement(manifest, "hero-main")).toMatchObject({ elementType: "section", label: "Hero" });
    expect(findEditableElement(manifest, "missing-card")).toBeNull();
    expect(describeElement({ canvasId: "hero-main", elementType: "section", label: "Hero" })).toBe("Hero (section)");
    expect(describeElement({ canvasId: "hero-main", elementType: "section", label: null })).toBe("section");
  });

  it("restores only fully valid persisted selections", () => {
    const stored = { selectedElement: { canvasId: "hero-main", elementType: "section", label: "Hero", ownerType: "page", ownerId: "11111111-1111-4111-8111-111111111111" } };
    expect(readResolvedSelection(stored)).toMatchObject({ canvasId: "hero-main", ownerType: "page" });
    expect(readResolvedSelection({ selectedElement: { canvasId: "hero-main" } })).toBeNull();
    expect(readResolvedSelection({ selectedMediaCount: 2 })).toBeNull();
    expect(readResolvedSelection(null)).toBeNull();
  });
});
