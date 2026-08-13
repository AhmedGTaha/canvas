import type { ResolvedDesignTokens } from "@/domain/theme/resolver";

/**
 * Class and token contract that generated pages and Building Blocks are written
 * against. Shared by the sandboxed Preview and by exported standalone projects so a
 * site looks identical in both.
 */
export const GENERATED_RUNTIME_CSS = `.generated-page-root,.c-page{min-height:100vh;background:var(--color-background);color:var(--color-text)}:where(.generated-page-root,.c-page) a{color:var(--color-accent);text-decoration-color:color-mix(in srgb,var(--color-accent) 55%,transparent);text-underline-offset:.18em}:where(.generated-page-root,.c-page) a:hover{color:var(--color-primary)}:where(.generated-page-root,.c-page) button{font:inherit;color:var(--color-text);border:var(--border-width) solid var(--color-border);border-radius:var(--radius-md);background:var(--color-surface)}.c-container{width:min(1120px,100%);margin-inline:auto;padding-inline:clamp(var(--space-md),5vw,var(--space-xl))}.c-section{padding-block:clamp(var(--space-xl),8vw,96px)}.c-hero{display:grid;align-content:center;min-height:min(78vh,760px)}.c-stack{display:flex;flex-direction:column;gap:var(--space-md)}.c-row{display:flex;align-items:center;flex-wrap:wrap;gap:var(--space-md)}.c-cluster{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--space-md)}.c-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr));gap:var(--space-lg)}.c-card{padding:var(--space-lg);border:var(--border-width) solid var(--color-border);border-radius:var(--radius-lg);background:var(--color-surface);box-shadow:var(--shadow-sm)}.c-surface{background:var(--color-surface);color:var(--color-text)}.c-bordered{border:var(--border-width) solid var(--color-border)}.c-rounded{border-radius:var(--radius-lg)}.c-shadow{box-shadow:var(--shadow-md)}.c-actions{display:flex;align-items:center;flex-wrap:wrap;gap:var(--space-sm)}.c-navbar,nav.c-section{min-height:calc(var(--body-size)*4.5);padding-block:var(--space-sm);border-bottom:var(--border-width) solid var(--color-border);background:var(--color-surface);color:var(--color-text);box-shadow:var(--shadow-sm)}:where(.c-navbar,nav.c-section)>.c-container.c-actions{justify-content:space-between}.c-navbar .canvas-image,nav.c-section .canvas-image{width:auto;height:calc(var(--body-size)*2.5);max-width:min(12rem,40vw);object-fit:contain}.c-nav-brand{display:inline-flex;align-items:center;flex:0 1 auto;color:var(--color-text);text-decoration:none}.c-nav-links{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:var(--space-md)}.c-link{color:var(--color-secondary);font-weight:650;text-decoration:none}.c-link:hover{color:var(--color-accent)}.c-button{display:inline-flex;min-height:calc(var(--body-size)*2.75);align-items:center;justify-content:center;padding:var(--space-sm) var(--space-md);border:var(--border-width) solid var(--color-primary);border-radius:var(--radius-md);background:var(--color-primary);color:var(--color-background);font-weight:700;text-decoration:none;box-shadow:var(--shadow-sm)}.c-button-secondary{border-color:var(--color-border);background:var(--color-surface);color:var(--color-primary)}.c-muted{color:var(--color-muted-text)}.c-kicker{color:var(--color-accent);font-size:calc(var(--body-size)*.75);font-weight:750;letter-spacing:.1em;text-transform:uppercase}.canvas-image{display:block;max-width:100%;height:auto}img.c-media{display:block;width:100%;height:auto;border-radius:var(--radius-lg);object-fit:cover}img.c-logo{display:block;width:auto;height:calc(var(--body-size)*2.5);max-width:min(12rem,40vw);object-fit:contain;border-radius:var(--radius-sm)}:where(.generated-page-root,.c-page) h1{font-size:clamp(calc(var(--heading-size)*.85),7vw,calc(var(--heading-size)*1.75));line-height:1.02}:where(.generated-page-root,.c-page) h2{font-size:clamp(calc(var(--heading-size)*.65),4vw,calc(var(--heading-size)*1.2));line-height:1.1}:where(.generated-page-root,.c-page) :focus-visible{outline:calc(var(--border-width)*3) solid var(--color-accent);outline-offset:3px}@media(max-width:640px){.c-cluster{align-items:flex-start;flex-direction:column}.c-nav-links{justify-content:flex-start}.c-actions{align-items:stretch;flex-direction:column}.c-button{width:100%}}`;

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
