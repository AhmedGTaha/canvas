import type { ThemeSettingsInput } from "./schemas";

/**
 * Curated project themes.
 *
 * A preset is a complete design system, not a palette: light and dark semantic colours,
 * the five design scales, and the heading and body typefaces. They are ordinary theme
 * values — applying a preset writes exactly what the Design panel writes, through the same
 * project theme service, and every field stays editable afterwards. Generated pages never
 * see a preset: they consume the resolved project tokens like any other theme.
 *
 * A preset is emphatically not a page template. It fixes the visual vocabulary — colour,
 * type, radius, spacing, shadow, border weight — and says nothing about hero shape,
 * section order, column counts, or where a call to action goes. Two sites on the same
 * preset should read as the same design language and still be laid out completely
 * differently, so a description here describes visual character and never composition.
 *
 * The set is deliberately small and deliberately spans a range: restrained presets a
 * professional-services site can ship untouched, and expressive ones that still hold up
 * as real websites. Contrast pairs (text on background, text on surface, background on
 * primary) were chosen to clear WCAG AA for body text in both schemes.
 */
export type ThemePresetTone = "restrained" | "warm" | "expressive";

export type ThemePreset = {
  id: string;
  name: string;
  description: string;
  tone: ThemePresetTone;
  theme: ThemeSettingsInput;
};

/** The presets, in the order the picker shows them: restrained first. */
export const THEME_PRESETS: readonly ThemePreset[] = Object.freeze([
  {
    id: "canvas-neutral",
    name: "Canvas Neutral",
    description: "Near-black type on white with a confident blue accent, set in the system sans. The safe default for any business.",
    tone: "restrained",
    theme: {
      lightTokens: { primary: "#111111", secondary: "#6B7280", accent: "#2563EB", background: "#FFFFFF", surface: "#F8F9FA", text: "#111111", mutedText: "#6B7280", border: "#E5E7EB" },
      darkTokens: { primary: "#F5F5F5", secondary: "#A1A1AA", accent: "#60A5FA", background: "#0A0A0A", surface: "#171717", text: "#F5F5F5", mutedText: "#A1A1AA", border: "#2A2A2A" },
      radiusScale: 50, spacingScale: 50, shadowScale: 50, fontScale: 50, borderScale: 50,
      typography: { headingFont: "system-sans", bodyFont: "system-sans" },
    },
  },
  {
    id: "nordic-slate",
    name: "Nordic Slate",
    description: "Cool greys, a steady steel blue and a plain system sans. Roomy and quiet — consultancies, studios, B2B.",
    tone: "restrained",
    theme: {
      lightTokens: { primary: "#1E293B", secondary: "#64748B", accent: "#0F62A6", background: "#F8FAFC", surface: "#FFFFFF", text: "#0F172A", mutedText: "#64748B", border: "#DDE3EA" },
      darkTokens: { primary: "#E2E8F0", secondary: "#94A3B8", accent: "#7DB4E8", background: "#0B1220", surface: "#141E30", text: "#E7EDF5", mutedText: "#9AA9BC", border: "#25314A" },
      radiusScale: 34, spacingScale: 66, shadowScale: 28, fontScale: 50, borderScale: 40,
      typography: { headingFont: "system-sans", bodyFont: "system-sans" },
    },
  },
  {
    id: "editorial-ink",
    name: "Editorial Ink",
    description: "Georgia headings over Arial body copy, square corners, large type, almost no shadow. Reads like a printed page.",
    tone: "restrained",
    theme: {
      lightTokens: { primary: "#161616", secondary: "#5A5A5A", accent: "#9A3412", background: "#FBFAF7", surface: "#FFFFFF", text: "#161616", mutedText: "#5F5C56", border: "#DCD8CF" },
      darkTokens: { primary: "#F2EFE9", secondary: "#A8A399", accent: "#E4894F", background: "#111010", surface: "#1B1A18", text: "#F2EFE9", mutedText: "#A8A399", border: "#302E2A" },
      radiusScale: 4, spacingScale: 70, shadowScale: 6, fontScale: 72, borderScale: 34,
      typography: { headingFont: "georgia", bodyFont: "arial" },
    },
  },
  {
    id: "atlantic",
    name: "Atlantic",
    description: "Deep navy with a teal accent, serif headings over a sans body. Corporate without being cold.",
    tone: "restrained",
    theme: {
      lightTokens: { primary: "#0C2A43", secondary: "#4E6E86", accent: "#0E7C86", background: "#FFFFFF", surface: "#F2F7FA", text: "#0C2A43", mutedText: "#557186", border: "#D6E3EB" },
      darkTokens: { primary: "#DCEAF3", secondary: "#8FAABE", accent: "#4FC3CC", background: "#071624", surface: "#0F2436", text: "#E4EFF6", mutedText: "#93AABB", border: "#1D3A4F" },
      radiusScale: 42, spacingScale: 54, shadowScale: 40, fontScale: 50, borderScale: 38,
      typography: { headingFont: "system-serif", bodyFont: "system-sans" },
    },
  },
  {
    id: "evergreen",
    name: "Evergreen",
    description: "Forest greens on warm paper, Georgia headings over a clean sans. Growers, clinics, sustainability, outdoors.",
    tone: "restrained",
    theme: {
      lightTokens: { primary: "#14432A", secondary: "#5A7360", accent: "#2F7D4F", background: "#FAFAF6", surface: "#FFFFFF", text: "#152A1D", mutedText: "#5A6D5F", border: "#DCE3D8" },
      darkTokens: { primary: "#DCEEE1", secondary: "#96AE9C", accent: "#6ABF87", background: "#0A1410", surface: "#12211A", text: "#E3F0E6", mutedText: "#9AAF9F", border: "#22362A" },
      radiusScale: 46, spacingScale: 58, shadowScale: 30, fontScale: 50, borderScale: 36,
      typography: { headingFont: "georgia", bodyFont: "system-sans" },
    },
  },
  {
    id: "monogram",
    name: "Monogram",
    description: "One accent, hairline borders, generous air, Garamond headings over Helvetica. Architecture, design, high-end services.",
    tone: "restrained",
    theme: {
      lightTokens: { primary: "#1C1C1C", secondary: "#767676", accent: "#7A6A50", background: "#FFFFFF", surface: "#F6F5F2", text: "#1C1C1C", mutedText: "#6E6E6E", border: "#E3E1DB" },
      darkTokens: { primary: "#F0EEE9", secondary: "#A5A29A", accent: "#C6AE83", background: "#0D0D0C", surface: "#181817", text: "#F0EEE9", mutedText: "#A09D95", border: "#2B2A27" },
      radiusScale: 10, spacingScale: 82, shadowScale: 12, fontScale: 58, borderScale: 20,
      typography: { headingFont: "garamond", bodyFont: "helvetica" },
    },
  },
  {
    id: "terracotta",
    name: "Terracotta",
    description: "Clay, sand and soft shadow, Georgia headings over wide-set Verdana. Hospitality, interiors, artisan trades.",
    tone: "warm",
    theme: {
      lightTokens: { primary: "#8C3D22", secondary: "#8A6A57", accent: "#B4531F", background: "#FDF8F3", surface: "#FFFFFF", text: "#31211A", mutedText: "#7C6558", border: "#EADCCF" },
      darkTokens: { primary: "#F6DCCB", secondary: "#B79A88", accent: "#E08A55", background: "#150F0C", surface: "#221814", text: "#F6E9E0", mutedText: "#B49B8C", border: "#3A2820" },
      radiusScale: 62, spacingScale: 60, shadowScale: 52, fontScale: 52, borderScale: 34,
      typography: { headingFont: "georgia", bodyFont: "verdana" },
    },
  },
  {
    id: "saffron",
    name: "Saffron",
    description: "Charcoal, cream and a saffron accent, Times New Roman headings over Tahoma. Built for menus, food and drink.",
    tone: "warm",
    theme: {
      lightTokens: { primary: "#26221C", secondary: "#7A6E5D", accent: "#B4740B", background: "#FCF9F2", surface: "#FFFFFF", text: "#26221C", mutedText: "#736A5B", border: "#E8E0CF" },
      darkTokens: { primary: "#F7EFDF", secondary: "#B2A48C", accent: "#E8B24B", background: "#12100C", surface: "#1E1A14", text: "#F7F1E4", mutedText: "#B0A48E", border: "#332C21" },
      radiusScale: 30, spacingScale: 64, shadowScale: 34, fontScale: 60, borderScale: 30,
      typography: { headingFont: "times-new-roman", bodyFont: "tahoma" },
    },
  },
  {
    id: "rose-quartz",
    name: "Rose Quartz",
    description: "Soft pinks on warm white, rounded and light, serif headings over a soft sans. Boutiques, salons, wellness.",
    tone: "warm",
    theme: {
      lightTokens: { primary: "#8A3A57", secondary: "#93707E", accent: "#C24A73", background: "#FFFAFB", surface: "#FFFFFF", text: "#2E1F26", mutedText: "#846B75", border: "#F1DEE4" },
      darkTokens: { primary: "#F8DCE6", secondary: "#C0A0AC", accent: "#F08BAE", background: "#150E12", surface: "#20161B", text: "#F8E9EE", mutedText: "#BEA3AD", border: "#38262E" },
      radiusScale: 78, spacingScale: 56, shadowScale: 40, fontScale: 48, borderScale: 24,
      typography: { headingFont: "system-serif", bodyFont: "system-sans" },
    },
  },
  {
    id: "oceanic",
    name: "Oceanic",
    description: "Bright cyan on deep blue-grey in a neutral system sans. Software, data, anything that should feel current.",
    tone: "expressive",
    theme: {
      lightTokens: { primary: "#0B3B57", secondary: "#4C7A8A", accent: "#0284A8", background: "#F7FBFD", surface: "#FFFFFF", text: "#08283A", mutedText: "#4E7182", border: "#D2E4EC" },
      darkTokens: { primary: "#D6F0FA", secondary: "#89AFC0", accent: "#38BDF8", background: "#05141D", surface: "#0C2231", text: "#E1F2FA", mutedText: "#8FB0C0", border: "#173547" },
      radiusScale: 56, spacingScale: 50, shadowScale: 46, fontScale: 50, borderScale: 32,
      typography: { headingFont: "system-sans", bodyFont: "system-sans" },
    },
  },
  {
    id: "graphite-lime",
    name: "Graphite Lime",
    description: "Industrial greys cut by an electric lime, Trebuchet headings over monospace body text. Engineering, motorsport, fabrication.",
    tone: "expressive",
    theme: {
      lightTokens: { primary: "#1A1D1A", secondary: "#5F6660", accent: "#3F7A12", background: "#F5F6F4", surface: "#FFFFFF", text: "#14170F", mutedText: "#5C635B", border: "#DCE0DA" },
      darkTokens: { primary: "#EDF2E6", secondary: "#9AA394", accent: "#A3E635", background: "#0C0E0B", surface: "#171A15", text: "#EEF3E7", mutedText: "#98A292", border: "#2A2F26" },
      radiusScale: 14, spacingScale: 44, shadowScale: 22, fontScale: 54, borderScale: 62,
      typography: { headingFont: "trebuchet-ms", bodyFont: "system-mono" },
    },
  },
  {
    id: "plum-velvet",
    name: "Plum Velvet",
    description: "Deep plum, gold accent, lifted surfaces, Garamond headings over a quiet sans. Events, hotels, premium retail.",
    tone: "expressive",
    theme: {
      lightTokens: { primary: "#42154A", secondary: "#7A5A82", accent: "#9A6A18", background: "#FCF9FC", surface: "#FFFFFF", text: "#2B0F31", mutedText: "#755B7C", border: "#EADFEC" },
      darkTokens: { primary: "#F0DBF4", secondary: "#B694BE", accent: "#E3B457", background: "#120A15", surface: "#1F1224", text: "#F3E6F5", mutedText: "#B79EBE", border: "#361F3D" },
      radiusScale: 58, spacingScale: 62, shadowScale: 74, fontScale: 54, borderScale: 26,
      typography: { headingFont: "garamond", bodyFont: "system-sans" },
    },
  },
  {
    id: "sunrise-coral",
    name: "Sunrise Coral",
    description: "Coral and warm ink, big radii, Trebuchet headings over a system sans. Consumer brands with something to say.",
    tone: "expressive",
    theme: {
      lightTokens: { primary: "#B33A2B", secondary: "#8B6259", accent: "#E0552F", background: "#FFF9F6", surface: "#FFFFFF", text: "#2C1712", mutedText: "#836057", border: "#F5DFD6" },
      darkTokens: { primary: "#FBD9CD", secondary: "#C39C90", accent: "#FF8154", background: "#160F0C", surface: "#221713", text: "#FCE7DE", mutedText: "#C09B8E", border: "#3B2720" },
      radiusScale: 84, spacingScale: 58, shadowScale: 56, fontScale: 62, borderScale: 22,
      typography: { headingFont: "trebuchet-ms", bodyFont: "system-sans" },
    },
  },
  {
    id: "midnight-neon",
    name: "Midnight Neon",
    description: "Dark-first with a violet glow, sans headings over monospace body copy. Nightlife, music, launches — loud on purpose.",
    tone: "expressive",
    theme: {
      lightTokens: { primary: "#2E1065", secondary: "#6D5B96", accent: "#7C3AED", background: "#FAF8FF", surface: "#FFFFFF", text: "#1B1035", mutedText: "#6B5C8E", border: "#E4DCF7" },
      darkTokens: { primary: "#E9E1FF", secondary: "#A093C7", accent: "#A78BFA", background: "#08060F", surface: "#150F26", text: "#EDE7FF", mutedText: "#A497C9", border: "#2B2145" },
      radiusScale: 68, spacingScale: 52, shadowScale: 84, fontScale: 56, borderScale: 28,
      typography: { headingFont: "system-sans", bodyFont: "system-mono" },
    },
  },
]);

export const THEME_PRESET_IDS = THEME_PRESETS.map((preset) => preset.id);

export function findThemePreset(id: string): ThemePreset | null {
  return THEME_PRESETS.find((preset) => preset.id === id) ?? null;
}
