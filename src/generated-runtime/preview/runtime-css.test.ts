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

  /*
   * A generated site is a standalone document: it does not load Canvas's own base.css,
   * so this stylesheet is the only place its reduced-motion behaviour can be decided.
   * The bar is "gentler, not none" — colour feedback survives, movement does not.
   */
  describe("motion", () => {
    const motion = GENERATED_RUNTIME_CSS.slice(GENERATED_RUNTIME_CSS.indexOf(":where(.generated-page-root,.c-page) a,"));
    const guarded = motion.slice(motion.indexOf("@media(prefers-reduced-motion:no-preference)"));
    const unguarded = motion.slice(0, motion.indexOf("@media(prefers-reduced-motion:no-preference)"));

    it("keeps colour feedback for a visitor who asked for less motion", () => {
      expect(unguarded).toContain("transition:background-color");
      expect(unguarded).toContain("color .16s");
      expect(unguarded).toContain("box-shadow");
    });

    it("puts every movement behind prefers-reduced-motion", () => {
      // Nothing outside the guarded block may transform or run keyframes.
      expect(unguarded).not.toMatch(/transform|@keyframes|animation:/);
      expect(guarded).toContain("transform:translateY");
      expect(guarded).toContain("@keyframes c-reveal");
    });

    it("gates hover lifts on a real pointer so a tap does not leave a card raised", () => {
      const hover = motion.slice(motion.indexOf("(hover:hover)"));
      expect(hover).toContain("(pointer:fine)");
      expect(hover).toContain(".c-button:hover");
      expect(hover).toContain("a:hover>.c-card");
      // A hover lift outside the pointer gate would stick on touch.
      expect(guarded.slice(0, guarded.indexOf("(hover:hover)"))).not.toContain(":hover{transform");
    });

    it("never animates on load and never loops", () => {
      expect(motion).not.toContain("infinite");
      expect(motion).not.toMatch(/animation:[^;}]*(?<!c-reveal )\bforwards\b/);
      // The only keyframe is the menu reveal, which runs on an explicit toggle.
      expect([...motion.matchAll(/@keyframes (\S+?)\{/g)].map((match) => match[1])).toEqual(["c-reveal"]);
    });
  });

  /*
   * Found by running the real product on a phone-width Preview: generated source says
   * "closed" with the `hidden` attribute, but `hidden` is a user-agent rule that any
   * author declaration outranks, so `.c-nav-links{display:flex}` kept every mobile menu
   * permanently open — and with it every accordion and tab panel.
   */
  describe("disclosure", () => {
    it("makes the hidden attribute beat the layout classes in this stylesheet", () => {
      expect(GENERATED_RUNTIME_CSS).toContain("[hidden]{display:none!important}");
      // It has to come after the class that defeated it, or specificity is moot.
      expect(GENERATED_RUNTIME_CSS.indexOf(".c-nav-links{display:flex")).toBeLessThan(GENERATED_RUNTIME_CSS.indexOf("[hidden]{display:none!important}"));
    });

    it("collapses a navbar only on phones, and hides its toggle everywhere else", () => {
      expect(GENERATED_RUNTIME_CSS).toContain("@media(min-width:641px){.c-navbar .c-nav-links[hidden]{display:flex!important}");
      // The toggle is found by the aria-controls it needs anyway, not by a special class.
      expect(GENERATED_RUNTIME_CSS).toContain(".c-navbar button[aria-controls]{display:none!important}");
    });
  });
});
