/**
 * The shared design-system classes every generated document inherits.
 *
 * These are implemented once by the Canvas runtime stylesheet, which ships to the Preview
 * and into every export, and they resolve colour, spacing, radius, shadow, typography, and
 * borders through the project theme. A generated document may also define its own classes
 * in its own CSS — that is what the `css` half of the contract is for — but anything built
 * on these stays on-theme for free and keeps following the project when the theme changes.
 */
export const GENERATED_RUNTIME_CLASSES = [
  "c-page", "c-container", "c-section", "c-hero", "c-stack", "c-row", "c-cluster", "c-grid",
  "c-card", "c-surface", "c-bordered", "c-rounded", "c-shadow", "c-actions",
  "c-navbar", "c-nav-brand", "c-nav-links", "c-link",
  "c-button", "c-button-secondary", "c-muted", "c-kicker", "c-media", "c-logo",
] as const;

export const GENERATED_RUNTIME_CLASS_SET: ReadonlySet<string> = new Set(GENERATED_RUNTIME_CLASSES);

export const GENERATED_RUNTIME_CLASS_GUIDE = `Canvas supplies these theme-aware classes. Build on them first, and add your own classes in the css field only for what they do not cover:
- Layout: c-page, c-container, c-section, c-hero, c-stack (vertical), c-row (wrapping row), c-cluster (space-between row), c-grid, c-actions.
- Surfaces: c-card, c-surface, c-bordered, c-rounded, c-shadow.
- Navbar: c-navbar on the nav, c-nav-brand on the logo link, c-nav-links around navigation links, and c-link on normal text links.
- Actions/text/media: c-button, c-button-secondary, c-muted, c-kicker, c-media for content images, and c-logo on an image that is a brand logo.
All of these classes resolve colors, spacing, radius, shadows, typography, and borders through the current project theme and update automatically when that theme changes.
Your own CSS must use the same theme variables — var(--color-primary), var(--color-surface), var(--space-lg), var(--radius-md), var(--shadow-md), var(--border-width) — rather than hard-coded colours or pixel values, so a theme change keeps working.`;
