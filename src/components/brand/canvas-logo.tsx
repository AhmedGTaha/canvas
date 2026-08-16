import type { CSSProperties } from "react";

/**
 * The Canvas logo. One implementation, every surface.
 *
 * Before this there were three marks: a `C` typed into a `<span>` on the auth
 * screen, the same `<span>` again in the dashboard bar, and — in the workspace
 * title bar, the place the product is used all day — a borrowed `Command` glyph
 * from the icon set, which is not the Canvas logo at all. A brand that is
 * re-typed at each call site is a brand that drifts, so the mark is drawn once,
 * here, as geometry rather than as a letter in whatever font happens to load.
 *
 * The drawing is the mark Canvas already had, made properly: the rounded tile,
 * and the C as an aperture cut out of it. Both take their colour from the ink
 * tokens, so the dark-background treatment is the same logo with the appearance
 * inverted underneath it — not a second logo maintained in parallel.
 *
 * `variant` chooses how much of the brand is shown, never which brand:
 *   full    the mark and the wordmark, for signing in and for navigation
 *   mark    the mark alone, where the product name is already on screen or
 *           where there is no room for it (a phone title bar, a favicon-sized
 *           slot). The accessible name is carried either way.
 */
export type CanvasLogoSize = "sm" | "md" | "lg" | "xl";

const TILE: Record<CanvasLogoSize, number> = { sm: 20, md: 24, lg: 28, xl: 40 };

export function CanvasLogo({
  variant = "full", size = "md", className, title = "Canvas",
}: {
  variant?: "full" | "mark";
  size?: CanvasLogoSize;
  className?: string;
  /** The accessible name. Only worth changing where the surrounding link already says "Canvas". */
  title?: string;
}) {
  const classes = ["canvas-logo", `canvas-logo-${size}`, className].filter(Boolean).join(" ");
  // The wordmark is real text, so it inherits the surface's type, tracking and
  // the user's text-size setting rather than being baked into the artwork.
  return <span className={classes} data-variant={variant} style={{ "--canvas-logo-tile": `${TILE[size]}px` } as CSSProperties}>
    <CanvasMark />
    {variant === "full"
      ? <span className="canvas-logo-word">Canvas</span>
      : <span className="sr-only">{title}</span>}
  </span>;
}

/** The mark on its own, as artwork. Everything visible here is decorative: the name comes from the wrapper. */
function CanvasMark() {
  return <svg className="canvas-logo-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <rect width="32" height="32" rx="9" className="canvas-logo-tile" />
    {/* A single arc, opening to the right: the C as a shape, not a glyph. */}
    <path d="M20.38 11.62A6.2 6.2 0 1 0 20.38 20.38" className="canvas-logo-c" fill="none" strokeWidth="3.4" strokeLinecap="round" />
  </svg>;
}
