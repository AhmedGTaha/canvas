import { describe, expect, it } from "vitest";
import { normalizeEmail } from "./email";

describe("normalizeEmail", () => {
  it("trims, normalizes, and lowercases email addresses", () => {
    expect(normalizeEmail("  TEAM@Example.COM  ")).toBe("team@example.com");
    expect(normalizeEmail("Ａ@EXAMPLE.COM")).toBe("a@example.com");
  });
});
