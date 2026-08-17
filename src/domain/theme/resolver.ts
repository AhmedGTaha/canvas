import { resolveFontStack } from "./fonts";
import type { SemanticColorTokens, ThemeSettingsInput } from "./schemas";

export type ResolvedDesignTokens = {
  colors: { light: SemanticColorTokens; dark: SemanticColorTokens };
  radius: { sm: string; md: string; lg: string; xl: string };
  spacing: { multiplier: number; xs: string; sm: string; md: string; lg: string; xl: string };
  shadows: { sm: string; md: string; lg: string };
  /**
   * `multiplier`, `body` and `heading` are the font *scale*; `headingFamily` and
   * `bodyFamily` are the resolved font stacks. Size and family are separate decisions and
   * are resolved separately.
   */
  typography: { multiplier: number; body: string; heading: string; headingFamily: string; bodyFamily: string };
  borders: { width: string; strongWidth: string };
};

const round = (value: number, places = 2) => Number(value.toFixed(places));

export function resolveProjectDesignTokens(theme: ThemeSettingsInput): ResolvedDesignTokens {
  const radius = theme.radiusScale / 100;
  const spacingMultiplier = round(0.75 + theme.spacingScale * 0.0075, 3);
  const shadow = theme.shadowScale / 100;
  const fontMultiplier = round(0.85 + theme.fontScale * 0.003, 3);
  const borderWidth = round(0.5 + theme.borderScale * 0.015, 2);
  const shadowValue = (y: number, blur: number, opacity: number) => shadow === 0 ? "none" : `0 ${round(y * shadow)}px ${round(blur * shadow)}px rgba(15, 23, 42, ${round(opacity * shadow, 3)})`;
  return {
    colors: { light: theme.lightTokens, dark: theme.darkTokens },
    radius: {
      sm: `${round(2 + radius * 6)}px`, md: `${round(4 + radius * 10)}px`,
      lg: `${round(8 + radius * 16)}px`, xl: `${round(12 + radius * 24)}px`,
    },
    spacing: {
      multiplier: spacingMultiplier,
      xs: `${round(4 * spacingMultiplier)}px`, sm: `${round(8 * spacingMultiplier)}px`,
      md: `${round(16 * spacingMultiplier)}px`, lg: `${round(24 * spacingMultiplier)}px`, xl: `${round(40 * spacingMultiplier)}px`,
    },
    shadows: { sm: shadowValue(1, 3, 0.12), md: shadowValue(4, 14, 0.16), lg: shadowValue(12, 30, 0.2) },
    typography: {
      multiplier: fontMultiplier,
      body: `${round(16 * fontMultiplier)}px`,
      heading: `${round(36 * fontMultiplier)}px`,
      headingFamily: resolveFontStack(theme.typography.headingFont),
      bodyFamily: resolveFontStack(theme.typography.bodyFont),
    },
    borders: { width: `${borderWidth}px`, strongWidth: `${round(borderWidth + 0.75)}px` },
  };
}

export function projectThemeCssVariables(resolved: ResolvedDesignTokens, mode: "light" | "dark") {
  const colors = resolved.colors[mode];
  return {
    "--project-primary": colors.primary,
    "--project-secondary": colors.secondary,
    "--project-accent": colors.accent,
    "--project-background": colors.background,
    "--project-surface": colors.surface,
    "--project-text": colors.text,
    "--project-muted-text": colors.mutedText,
    "--project-border": colors.border,
    "--project-radius-sm": resolved.radius.sm,
    "--project-radius-md": resolved.radius.md,
    "--project-radius-lg": resolved.radius.lg,
    "--project-radius-xl": resolved.radius.xl,
    "--project-space-scale": String(resolved.spacing.multiplier),
    "--project-space-sm": resolved.spacing.sm,
    "--project-space-md": resolved.spacing.md,
    "--project-space-lg": resolved.spacing.lg,
    "--project-shadow-sm": resolved.shadows.sm,
    "--project-shadow-md": resolved.shadows.md,
    "--project-font-scale": String(resolved.typography.multiplier),
    "--project-body-size": resolved.typography.body,
    "--project-heading-size": resolved.typography.heading,
    "--project-font-heading": resolved.typography.headingFamily,
    "--project-font-body": resolved.typography.bodyFamily,
    "--project-border-width": resolved.borders.width,
  } as const;
}
