import { describe, expect, it } from "vitest";
import { GENERATED_RUNTIME_CLASSES } from "@/domain/generated-source/runtime-classes";
import { DEFAULT_THEME } from "@/domain/theme/defaults";
import { resolveProjectDesignTokens } from "@/domain/theme/resolver";
import { GENERATED_RUNTIME_CSS, generatedThemeCss } from "./runtime-css";

describe("generated runtime theme CSS", () => {
  it("implements every validator-approved class in the shared Preview/export stylesheet", () => {
    for (const className of GENERATED_RUNTIME_CLASSES) expect(GENERATED_RUNTIME_CSS, className).toContain(`.${className}`);
  });

  it("uses tokens for navbar styling, browser-default controls, and constrained logos", () => {
    expect(GENERATED_RUNTIME_CSS).toContain("a{color:var(--color-accent)");
    expect(GENERATED_RUNTIME_CSS).toContain("button{font:inherit;color:var(--color-text)");
    expect(GENERATED_RUNTIME_CSS).toContain(".c-navbar,nav.c-section");
    expect(GENERATED_RUNTIME_CSS).toContain(">.c-container.c-actions{justify-content:space-between}");
    expect(GENERATED_RUNTIME_CSS).toContain("background:var(--color-surface)");
    expect(GENERATED_RUNTIME_CSS).toContain("gap:var(--space-md)");
    expect(GENERATED_RUNTIME_CSS).toContain("border-radius:var(--radius-md)");
    expect(GENERATED_RUNTIME_CSS).toContain("box-shadow:var(--shadow-sm)");
    expect(GENERATED_RUNTIME_CSS).toContain("nav.c-section .canvas-image{width:auto;height:calc(var(--body-size)*2.5)");
    expect(GENERATED_RUNTIME_CSS).toContain("img.c-logo{display:block;width:auto;height:calc(var(--body-size)*2.5)");
    expect(GENERATED_RUNTIME_CSS).not.toContain("blue");
  });

  it("emits independently switchable light and dark values plus every scale", () => {
    const theme = resolveProjectDesignTokens({
      ...DEFAULT_THEME,
      lightTokens: { ...DEFAULT_THEME.lightTokens, primary: "#112233", text: "#223344", surface: "#334455" },
      darkTokens: { ...DEFAULT_THEME.darkTokens, primary: "#AABBCC", text: "#BBCCDD", surface: "#CCDDEE" },
      radiusScale: 80, spacingScale: 70, shadowScale: 60, fontScale: 55, borderScale: 65,
    });
    const css = generatedThemeCss(theme);
    expect(css).toContain(":root[data-theme=light]{--color-primary:#112233;--color-secondary:");
    expect(css).toContain("--color-surface:#334455");
    expect(css).toContain(":root[data-theme=dark]{--color-primary:#AABBCC;--color-secondary:");
    expect(css).toContain("--color-surface:#CCDDEE");
    for (const variable of ["--radius-md", "--space-md", "--shadow-md", "--body-size", "--heading-size", "--border-width"]) expect(css).toContain(variable);
  });
});
