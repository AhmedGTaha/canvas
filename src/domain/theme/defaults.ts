import { DEFAULT_BODY_FONT, DEFAULT_HEADING_FONT } from "./fonts";
import type { ThemeSettingsInput } from "./schemas";

export const DEFAULT_LIGHT_TOKENS = Object.freeze({
  primary: "#111111", secondary: "#6B7280", accent: "#2563EB", background: "#FFFFFF",
  surface: "#F8F9FA", text: "#111111", mutedText: "#6B7280", border: "#E5E7EB",
});

export const DEFAULT_DARK_TOKENS = Object.freeze({
  primary: "#F5F5F5", secondary: "#A1A1AA", accent: "#60A5FA", background: "#0A0A0A",
  surface: "#171717", text: "#F5F5F5", mutedText: "#A1A1AA", border: "#2A2A2A",
});

export const DEFAULT_THEME: ThemeSettingsInput = Object.freeze({
  lightTokens: DEFAULT_LIGHT_TOKENS,
  darkTokens: DEFAULT_DARK_TOKENS,
  radiusScale: 50,
  spacingScale: 50,
  shadowScale: 50,
  fontScale: 50,
  borderScale: 50,
  // The system stacks: what every project rendered with before typography was a setting,
  // so a project that has never touched it looks exactly as it did.
  typography: { headingFont: DEFAULT_HEADING_FONT, bodyFont: DEFAULT_BODY_FONT },
});
