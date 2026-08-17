import type { ResolvedDesignTokens } from "@/domain/theme/resolver";

/**
 * Class and token contract that generated pages and Building Blocks are written
 * against. Shared by the sandboxed Preview and by exported standalone projects so a
 * site looks identical in both.
 */
/**
 * Making `hidden` actually hide, and making a collapsing navbar collapse only where it
 * should.
 *
 * Generated source may only use static Canvas classes, so it expresses "this is closed"
 * with the `hidden` attribute — that is the documented pattern for menus, accordions and
 * tab panels. But `hidden` is styled by the *user agent* stylesheet, which any author
 * declaration outranks: `.c-nav-links{display:flex}` silently defeated it, so a mobile
 * menu rendered permanently open. `!important` is the correct tool here precisely
 * because it has to beat every layout class this stylesheet defines.
 *
 * Above the phone breakpoint a navigation bar shows its links and drops the toggle: the
 * toggle is identified by the `aria-controls` it must carry to be accessible at all, so
 * this needs no extra class and no cooperation from the generated markup.
 */
const GENERATED_RUNTIME_DISCLOSURE_CSS = `[hidden]{display:none!important}@media(min-width:641px){.c-navbar .c-nav-links[hidden]{display:flex!important}.c-navbar button[aria-controls]{display:none!important}}`;

/**
 * Motion for generated websites.
 *
 * It lives in the shared runtime stylesheet rather than in generated source for the same
 * reason colour does: generated components may only use static Canvas classes, so if
 * hover feedback and reveal transitions are not supplied here, no generated site can
 * have them — and every model would instead try to smuggle in inline styles the
 * validator rejects.
 *
 * Two tiers, because reduced motion means *gentler*, not none. Colour and shadow
 * feedback carries no movement and is what tells someone a link is a link, so it is
 * unconditional. Everything that actually moves — the press and hover lifts, the menu
 * reveal — is inside a no-preference query and simply does not exist for a visitor who
 * asked for less. This stylesheet ships to exported sites too, where there is no other
 * reduced-motion rule to fall back on.
 *
 * The lifts are additionally gated on a real pointer: on a touch screen `:hover` sticks
 * after a tap, so an ungated lift leaves a card raised until something else is touched.
 *
 * Nothing here animates on load, nothing loops, and nothing moves more than two pixels.
 */
const GENERATED_RUNTIME_MOTION_CSS = `:where(.generated-page-root,.c-page) a,:where(.generated-page-root,.c-page) button{transition:background-color .16s cubic-bezier(.2,.8,.3,1),border-color .16s cubic-bezier(.2,.8,.3,1),color .16s cubic-bezier(.2,.8,.3,1),box-shadow .16s cubic-bezier(.2,.8,.3,1)}.c-card{transition:border-color .18s cubic-bezier(.2,.8,.3,1),box-shadow .18s cubic-bezier(.2,.8,.3,1)}@media(prefers-reduced-motion:no-preference){:where(.generated-page-root,.c-page) a,:where(.generated-page-root,.c-page) button,.c-card{transition-property:background-color,border-color,color,box-shadow,transform}.c-button:active,.c-button-secondary:active{transform:translateY(1px)}.c-nav-links:not([hidden]){animation:c-reveal .18s cubic-bezier(.2,.8,.3,1)}@keyframes c-reveal{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}}@media(prefers-reduced-motion:no-preference) and (hover:hover) and (pointer:fine){.c-button:hover,.c-button-secondary:hover{transform:translateY(-1px)}a:hover>.c-card{transform:translateY(-2px);box-shadow:var(--shadow-md)}}`;

/**
 * Project typography, applied once here rather than by generated source.
 *
 * The heading and body typefaces are a project setting, so a document must not name a
 * family of its own: it writes ordinary headings and paragraphs and inherits the
 * project's stacks. Changing the fonts in Brand & Design then reflows every existing
 * page and every exported site without regenerating anything.
 */
const GENERATED_RUNTIME_TYPOGRAPHY_CSS = `:where(.generated-page-root,.c-page){font-family:var(--font-body)}:where(.generated-page-root,.c-page) :is(h1,h2,h3,h4,h5,h6){font-family:var(--font-heading)}`;

export const GENERATED_RUNTIME_CSS = `.generated-page-root,.c-page{min-height:100vh;background:var(--color-background);color:var(--color-text)}${GENERATED_RUNTIME_TYPOGRAPHY_CSS}:where(.generated-page-root,.c-page) a{color:var(--color-accent);text-decoration-color:color-mix(in srgb,var(--color-accent) 55%,transparent);text-underline-offset:.18em}:where(.generated-page-root,.c-page) a:hover{color:var(--color-primary)}:where(.generated-page-root,.c-page) button{font:inherit;color:var(--color-text);border:var(--border-width) solid var(--color-border);border-radius:var(--radius-md);background:var(--color-surface)}.c-container{width:min(1120px,100%);margin-inline:auto;padding-inline:clamp(var(--space-md),5vw,var(--space-xl))}.c-section{padding-block:clamp(var(--space-xl),8vw,96px)}.c-hero{display:grid;align-content:center;min-height:min(78vh,760px)}.c-stack{display:flex;flex-direction:column;gap:var(--space-md)}.c-row{display:flex;align-items:center;flex-wrap:wrap;gap:var(--space-md)}.c-cluster{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--space-md)}.c-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr));gap:var(--space-lg)}.c-card{padding:var(--space-lg);border:var(--border-width) solid var(--color-border);border-radius:var(--radius-lg);background:var(--color-surface);box-shadow:var(--shadow-sm)}.c-surface{background:var(--color-surface);color:var(--color-text)}.c-bordered{border:var(--border-width) solid var(--color-border)}.c-rounded{border-radius:var(--radius-lg)}.c-shadow{box-shadow:var(--shadow-md)}.c-actions{display:flex;align-items:center;flex-wrap:wrap;gap:var(--space-sm)}.c-navbar,nav.c-section{min-height:calc(var(--body-size)*4.5);padding-block:var(--space-sm);border-bottom:var(--border-width) solid var(--color-border);background:var(--color-surface);color:var(--color-text);box-shadow:var(--shadow-sm)}:where(.c-navbar,nav.c-section)>.c-container.c-actions{justify-content:space-between}.c-navbar .canvas-image,nav.c-section .canvas-image{width:auto;height:calc(var(--body-size)*2.5);max-width:min(12rem,40vw);object-fit:contain}.c-nav-brand{display:inline-flex;align-items:center;flex:0 1 auto;color:var(--color-text);text-decoration:none}.c-nav-links{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:var(--space-md)}.c-link{color:var(--color-secondary);font-weight:650;text-decoration:none}.c-link:hover{color:var(--color-accent)}.c-button{display:inline-flex;min-height:calc(var(--body-size)*2.75);align-items:center;justify-content:center;padding:var(--space-sm) var(--space-md);border:var(--border-width) solid var(--color-primary);border-radius:var(--radius-md);background:var(--color-primary);color:var(--color-background);font-weight:700;text-decoration:none;box-shadow:var(--shadow-sm)}.c-button-secondary{border-color:var(--color-border);background:var(--color-surface);color:var(--color-primary)}.c-muted{color:var(--color-muted-text)}.c-kicker{color:var(--color-accent);font-size:calc(var(--body-size)*.75);font-weight:750;letter-spacing:.1em;text-transform:uppercase}.canvas-image{display:block;max-width:100%;height:auto}img.c-media{display:block;width:100%;height:auto;border-radius:var(--radius-lg);object-fit:cover}img.c-logo{display:block;width:auto;height:calc(var(--body-size)*2.5);max-width:min(12rem,40vw);object-fit:contain;border-radius:var(--radius-sm)}:where(.generated-page-root,.c-page) h1{font-size:clamp(calc(var(--heading-size)*.85),7vw,calc(var(--heading-size)*1.75));line-height:1.02}:where(.generated-page-root,.c-page) h2{font-size:clamp(calc(var(--heading-size)*.65),4vw,calc(var(--heading-size)*1.2));line-height:1.1}:where(.generated-page-root,.c-page) :focus-visible{outline:calc(var(--border-width)*3) solid var(--color-accent);outline-offset:3px}@media(max-width:640px){.c-cluster{align-items:flex-start;flex-direction:column}.c-nav-links{justify-content:flex-start}.c-actions{align-items:stretch;flex-direction:column}.c-button{width:100%}}${GENERATED_RUNTIME_DISCLOSURE_CSS}${GENERATED_RUNTIME_MOTION_CSS}`;

type ThemeLike = {
  colors: { light: Record<string, string>; dark: Record<string, string> };
  radius: Record<string, string>;
  spacing: Record<string, string | number>;
  shadows: Record<string, string>;
  typography: { body: string; heading: string; headingFamily: string; bodyFamily: string };
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
    variable("body-size", theme.typography.body), variable("heading-size", theme.typography.heading),
    variable("font-heading", theme.typography.headingFamily), variable("font-body", theme.typography.bodyFamily),
    variable("border-width", theme.borders.width),
  ].join(";");
}

/** Project design tokens as CSS custom properties for both color schemes. */
export function generatedThemeCss(theme: ThemeLike | ResolvedDesignTokens) {
  return `:root{${themeScaleDeclarations(theme)}}:root[data-theme=light]{${themeColorDeclarations(theme, "light")}}:root[data-theme=dark]{${themeColorDeclarations(theme, "dark")}}`;
}

/** Minimal document reset for a standalone exported site (Preview supplies its own). */
export const EXPORT_BASE_CSS = `:root{color-scheme:light dark}*{box-sizing:border-box}html,body{min-height:100%;margin:0}body{background:var(--color-background);color:var(--color-text);font:var(--body-size)/1.55 var(--font-body)}h1,h2,h3,h4,h5,h6{font-family:var(--font-heading)}img{max-width:100%}`;
