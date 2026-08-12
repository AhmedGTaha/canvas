import { describe, expect, it } from "vitest";
import { DEFAULT_THEME } from "./defaults";
import { projectThemeCssVariables, resolveProjectDesignTokens } from "./resolver";

describe("design-token resolver", () => {
  it("resolves identical input deterministically", () => {
    expect(resolveProjectDesignTokens(DEFAULT_THEME)).toEqual(resolveProjectDesignTokens(DEFAULT_THEME));
  });

  it("maps scale endpoints into controlled token ranges", () => {
    const low = resolveProjectDesignTokens({ ...DEFAULT_THEME, radiusScale: 0, spacingScale: 0, shadowScale: 0, fontScale: 0, borderScale: 0 });
    const high = resolveProjectDesignTokens({ ...DEFAULT_THEME, radiusScale: 100, spacingScale: 100, shadowScale: 100, fontScale: 100, borderScale: 100 });
    expect(low).toMatchObject({ radius: { sm: "2px", md: "4px" }, spacing: { multiplier: 0.75 }, shadows: { sm: "none" }, typography: { multiplier: 0.85 }, borders: { width: "0.5px" } });
    expect(high).toMatchObject({ radius: { sm: "8px", md: "14px" }, spacing: { multiplier: 1.5 }, typography: { multiplier: 1.15 }, borders: { width: "2px" } });
  });

  it("produces namespaced serializable CSS variables for each mode", () => {
    const resolved = resolveProjectDesignTokens(DEFAULT_THEME);
    expect(projectThemeCssVariables(resolved, "light")["--project-background"]).toBe("#FFFFFF");
    expect(projectThemeCssVariables(resolved, "dark")["--project-background"]).toBe("#0A0A0A");
    expect(projectThemeCssVariables(resolved, "light")["--project-radius-md"]).toBe(resolved.radius.md);
  });
});
