import { describe, expect, it } from "vitest";
import { safeReturnTo } from "./return-to";

describe("invitation authentication return flow", () => {
  it("preserves a valid invite destination through sign-in or sign-up", () => {
    const token = "a".repeat(43);
    expect(safeReturnTo(`/invite/${token}`)).toBe(`/invite/${token}`);
  });

  it("rejects open redirects and unrelated return destinations", () => {
    expect(safeReturnTo("https://attacker.test/invite/token")).toBe("/dashboard");
    expect(safeReturnTo("/account")).toBe("/dashboard");
    expect(safeReturnTo("/invite/short")).toBe("/dashboard");
  });
});
