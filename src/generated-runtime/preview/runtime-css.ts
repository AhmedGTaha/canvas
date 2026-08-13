import type { ResolvedDesignTokens } from "@/domain/theme/resolver";

/**
 * Class and token contract that generated pages and Building Blocks are written
 * against. Shared by the sandboxed Preview and by exported standalone projects so a
 * site looks identical in both.
 */
export const GENERATED_RUNTIME_CSS = `.generated-page-root,.c-page{min-height:100vh;background:var(--color-background);color:var(--color-text)}.c-container{width:min(1120px,100%);margin-inline:auto;padding-inline:clamp(var(--space-md),5vw,var(--space-xl))}.c-section{padding-block:clamp(var(--space-xl),8vw,96px)}.c-hero{display:grid;align-content:center;min-height:min(78vh,760px)}.c-stack{display:flex;flex-direction:column;gap:var(--space-md)}.c-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr));gap:var(--space-lg)}.c-card{padding:var(--space-lg);border:var(--border-width) solid var(--color-border);border-radius:var(--radius-lg);background:var(--color-surface);box-shadow:var(--shadow-sm)}.c-actions{display:flex;flex-wrap:wrap;gap:var(--space-sm)}.c-button{display:inline-flex;min-height:44px;align-items:center;justify-content:center;padding:10px 18px;border:var(--border-width) solid var(--color-primary);border-radius:var(--radius-md);background:var(--color-primary);color:var(--color-background);font-weight:700;text-decoration:none}.c-button-secondary{background:var(--color-surface);color:var(--color-primary)}.c-muted{color:var(--color-muted-text)}.c-kicker{color:var(--color-accent);font-size:.75rem;font-weight:750;letter-spacing:.1em;text-transform:uppercase}.c-media{display:block;width:100%;height:auto;border-radius:var(--radius-lg);object-fit:cover}.c-page h1{font-size:clamp(2.25rem,7vw,5rem);line-height:1.02}.c-page h2{font-size:clamp(1.6rem,4vw,3rem);line-height:1.1}.c-page :focus-visible{outline:3px solid var(--color-accent);outline-offset:3px}@media(max-width:640px){.c-actions{align-items:stretch;flex-direction:column}.c-button{width:100%}}`;

type ThemeLike = {
  colors: { light: Record<string, string>; dark: Record<string, string> };
  radius: Record<string, string>;
  spacing: Record<string, string | number>;
  shadows: Record<string, string>;
  typography: { body: string; heading: string };
  borders: { width: string };
};

const variable = (name: string, value: string | number) => `--${name}:${value}`;

/** `--color-*` declarations for one color scheme. */
export function themeColorDeclarations(theme: ThemeLike | ResolvedDesignTokens, mode: "light" | "dark") {
  return Object.entries(theme.colors[mode]).map(([key, value]) => variable(`color-${key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}`, value)).join(";");
}

/** Non-color design tokens (radius, spacing, shadows, typography, borders). */
export function themeScaleDeclarations(theme: ThemeLike | ResolvedDesignTokens) {
  return [
    ...Object.entries(theme.radius).map(([key, value]) => variable(`radius-${key}`, value)),
    ...Object.entries(theme.spacing).filter(([key]) => key !== "multiplier").map(([key, value]) => variable(`space-${key}`, value)),
    ...Object.entries(theme.shadows).map(([key, value]) => variable(`shadow-${key}`, value)),
    variable("body-size", theme.typography.body), variable("heading-size", theme.typography.heading), variable("border-width", theme.borders.width),
  ].join(";");
}

/** Project design tokens as CSS custom properties for both color schemes. */
export function generatedThemeCss(theme: ThemeLike | ResolvedDesignTokens) {
  return `:root{${themeScaleDeclarations(theme)}}:root[data-theme=light]{${themeColorDeclarations(theme, "light")}}:root[data-theme=dark]{${themeColorDeclarations(theme, "dark")}}`;
}

/** Minimal document reset for a standalone exported site (Preview supplies its own). */
export const EXPORT_BASE_CSS = `:root{color-scheme:light dark}*{box-sizing:border-box}html,body{min-height:100%;margin:0}body{background:var(--color-background);color:var(--color-text);font:var(--body-size)/1.55 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}img{max-width:100%}`;
