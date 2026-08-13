import { describe, expect, it } from "vitest";
import { projectNameSchema, projectStatusSchema } from "@/domain/projects/schemas";
import { workspaceNameSchema } from "@/domain/workspaces/schemas";
import { brandSettingsSchema } from "@/domain/theme/schemas";

describe("workspace and project validation", () => {
  it("trims valid names", () => {
    expect(workspaceNameSchema.parse("  Product team  ")).toBe("Product team");
    expect(projectNameSchema.parse("  Marketing site  ")).toBe("Marketing site");
  });

  it("rejects blank and oversized names", () => {
    expect(workspaceNameSchema.safeParse("   ").success).toBe(false);
    expect(projectNameSchema.safeParse("x".repeat(101)).success).toBe(false);
  });

  it.each(["active", "archived", "deleted"])("accepts the %s project status", (status) => {
    expect(projectStatusSchema.parse(status)).toBe(status);
  });

  it("rejects unknown project statuses", () => {
    expect(projectStatusSchema.safeParse("published").success).toBe(false);
  });
});

describe("brand settings round trip", () => {
  it("accepts back exactly what it hands out", () => {
    // The service stores empty text as null and returns it that way, so the
    // editor sends null back on the next save. Rejecting null here made every
    // brand save fail for any project without a description.
    const first = brandSettingsSchema.parse({ companyName: "Flawless", companyDescription: "", brandNotes: "" });
    expect(first.companyDescription).toBeNull();
    expect(first.brandNotes).toBeNull();
    const second = brandSettingsSchema.safeParse({ companyName: first.companyName, companyDescription: first.companyDescription, brandNotes: first.brandNotes });
    expect(second.success).toBe(true);
    expect(second.data).toEqual(first);
  });

  it("still trims and bounds real text, and still requires a name", () => {
    expect(brandSettingsSchema.parse({ companyName: " Acme ", companyDescription: "  We build things  ", brandNotes: null }).companyDescription).toBe("We build things");
    expect(brandSettingsSchema.safeParse({ companyName: "   ", companyDescription: null, brandNotes: null }).success).toBe(false);
    expect(brandSettingsSchema.safeParse({ companyName: "Acme", companyDescription: "x".repeat(2001), brandNotes: null }).success).toBe(false);
  });
});
