/**
 * Authoritative class vocabulary for generated source. Every entry is implemented by
 * the shared Preview/export stylesheet; arbitrary utility-framework classes are not.
 */
export const GENERATED_RUNTIME_CLASSES = [
  "c-page", "c-container", "c-section", "c-hero", "c-stack", "c-row", "c-cluster", "c-grid",
  "c-card", "c-surface", "c-bordered", "c-rounded", "c-shadow", "c-actions",
  "c-navbar", "c-nav-brand", "c-nav-links", "c-link",
  "c-button", "c-button-secondary", "c-muted", "c-kicker", "c-media", "c-logo",
] as const;

export const GENERATED_RUNTIME_CLASS_SET: ReadonlySet<string> = new Set(GENERATED_RUNTIME_CLASSES);

export const GENERATED_RUNTIME_CLASS_GUIDE = `Use only static className strings composed from these Canvas classes:
- Layout: c-page, c-container, c-section, c-hero, c-stack (vertical), c-row (wrapping row), c-cluster (space-between row), c-grid, c-actions.
- Surfaces: c-card, c-surface, c-bordered, c-rounded, c-shadow.
- Navbar: c-navbar on the nav, c-nav-brand on the logo link, c-nav-links around navigation links, and c-link on normal text links.
- Actions/text/media: c-button, c-button-secondary, c-muted, c-kicker, c-media for content images, and c-logo on CanvasImage when it is a brand logo.
All of these classes resolve colors, spacing, radius, shadows, typography, and borders through the current project theme and update automatically when that theme changes.`;
