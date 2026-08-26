/**
 * The shared design-system classes every generated document inherits.
 *
 * These are implemented once by the Canvas runtime stylesheet, which ships to the Preview
 * and into every export, and they resolve colour, spacing, radius, shadow, typography, and
 * borders through the project theme. A generated document may also define its own classes
 * in its own CSS — that is what the `css` half of the contract is for — but anything built
 * on these stays on-theme for free and keeps following the project when the theme changes.
 *
 * They are split into two tiers on purpose. The infrastructure helpers are low-level and
 * carry no page structure of their own, so a new page may reach for them freely. The
 * compatibility helpers are semantic composition shortcuts (`c-hero`, `c-card`, `c-navbar`
 * …) kept working for the documents that already use them; they are *not* the first-choice
 * vocabulary for a new page, because a hero/card/navbar menu is exactly the hidden template
 * that made every generated site converge on one shape. Both tiers are still fully
 * supported by the runtime CSS and accepted by the validator — the split is about what new
 * generation is *guided toward*, never about what still renders.
 */
export const GENERATED_RUNTIME_INFRASTRUCTURE_CLASSES = [
  "c-page", "c-container", "c-section", "c-stack", "c-row", "c-cluster", "c-grid", "c-actions",
  "c-button", "c-button-secondary", "c-link", "c-media", "c-logo",
  "c-muted", "c-bordered", "c-rounded", "c-shadow",
] as const;

export const GENERATED_RUNTIME_COMPATIBILITY_CLASSES = [
  "c-hero", "c-card", "c-surface", "c-navbar", "c-nav-brand", "c-nav-links", "c-kicker",
] as const;

export const GENERATED_RUNTIME_CLASSES = [
  ...GENERATED_RUNTIME_INFRASTRUCTURE_CLASSES,
  ...GENERATED_RUNTIME_COMPATIBILITY_CLASSES,
] as const;

export const GENERATED_RUNTIME_CLASS_GUIDE = `Canvas provides optional theme-aware infrastructure helpers. Use only the helpers that naturally implement the page you are designing, and write the rest in the css field. They do not define section type, hierarchy, composition, or page structure — your document CSS is the normal place for page-specific composition, not a fallback.
- Layout primitives: c-page, c-container (the only width bound), c-section (base vertical rhythm), c-stack (vertical), c-row (wrapping row), c-cluster (space-between row), c-grid (auto-fit peers), c-actions.
- Treatment utilities: c-muted, c-bordered, c-rounded, c-shadow.
- Text, action, and media: c-button, c-button-secondary, c-link, c-media for content images, c-logo on a brand mark.
They resolve colours, spacing, radius, shadows, typography, and borders through the current project theme, and update automatically when that theme changes. They say how something looks, never which sections a page has or in what order.
Canvas also still supports the older semantic shortcuts c-hero, c-card, c-surface, c-navbar, c-nav-brand, c-nav-links, and c-kicker, and existing documents use them. Do not treat them as the default skeleton for a new page: reach for one only where that exact shape is genuinely what this page's content wants, and prefer composing the section yourself in css otherwise.
Headings inherit the project's heading typeface and everything else inherits its body typeface, so generated markup never declares a font family.
Your own CSS must use the same theme variables — var(--color-primary), var(--color-surface), var(--space-lg), var(--radius-md), var(--shadow-md), var(--font-heading), var(--font-body), var(--border-width) — rather than hard-coded colours, pixel values, or font names, so a theme change keeps working.`;
