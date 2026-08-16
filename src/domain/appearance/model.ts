/**
 * How Canvas itself looks: light, dark, or whatever the device is set to.
 *
 * This is the appearance of the *application*. It is not the theme of the
 * website being built — that lives in src/domain/theme and is stored per
 * project, has its own light and dark token sets, and is switched by the
 * preview's own appearance control. The two never read each other: a person
 * working in dark Canvas is still building a light website unless they said
 * otherwise, and this module is the boundary that keeps that true.
 */
export const APPEARANCES = ["system", "light", "dark"] as const;
export type Appearance = (typeof APPEARANCES)[number];

export const DEFAULT_APPEARANCE: Appearance = "system";

/**
 * Readable, not `__Host-` prefixed: the value is a display preference with no
 * security meaning, and the appearance control reads it back on the client to
 * apply the change before the server round trip lands.
 */
export const APPEARANCE_COOKIE = "canvas_appearance";

/** A year. An appearance choice is not a session — it is how the person wants the product to look. */
export const APPEARANCE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function parseAppearance(value: string | null | undefined): Appearance {
  return (APPEARANCES as readonly string[]).includes(value ?? "") ? (value as Appearance) : DEFAULT_APPEARANCE;
}

/**
 * What goes on <html data-appearance>. "system" writes no attribute at all, so
 * the `color-scheme: light dark` default in base.css resolves from the device
 * with no JavaScript and no flash.
 */
export function appearanceAttribute(appearance: Appearance): "light" | "dark" | undefined {
  return appearance === "system" ? undefined : appearance;
}

export const APPEARANCE_LABELS: Record<Appearance, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};
