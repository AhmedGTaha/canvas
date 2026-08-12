import { describe, expect, it } from "vitest";
import { projectNameSchema, projectStatusSchema } from "@/domain/projects/schemas";
import { workspaceNameSchema } from "@/domain/workspaces/schemas";

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
