"use client";

import { Check, CircleAlert, LoaderCircle, Moon, RotateCcw, Sun } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { resetThemeAction, saveBrandAction, saveThemeAction } from "@/app/actions/theme";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/panel";
import { SegmentedControl } from "@/components/ui/segmented";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Input, Select, Textarea } from "@/components/ui/form-controls";
import { Disclosure } from "@/components/ui/disclosure";
import { projectThemeCssVariables, resolveProjectDesignTokens } from "@/domain/theme/resolver";
import { THEME_PRESETS, type ThemePreset } from "@/domain/theme/presets";
import { FONT_CATEGORY_LABELS, FONT_CHOICES, type FontCategory } from "@/domain/theme/fonts";
import type { BrandSettingsInput, SemanticColorTokens, ThemeSettingsInput, TypographySettingsInput } from "@/domain/theme/schemas";
import { ThemePresetPicker } from "./theme-presets";

/* Idle renders nothing: a tick reading "Saved" on a form nobody has edited
   reports a save that never happened. */
type SaveStatus = "Idle" | "Saved" | "Saving" | "Error";
const COLOR_FIELDS: Array<{ key: keyof SemanticColorTokens; label: string }> = [
  { key: "primary", label: "Primary" }, { key: "secondary", label: "Secondary" }, { key: "accent", label: "Accent" },
  { key: "background", label: "Background" }, { key: "surface", label: "Surface" }, { key: "text", label: "Text" },
  { key: "mutedText", label: "Muted Text" }, { key: "border", label: "Border" },
];
type ScaleKey = Exclude<keyof ThemeSettingsInput, "lightTokens" | "darkTokens" | "typography">;
/* Font scale is not here: it belongs beside the typefaces in Typography, because
   "how big" and "which face" are the same decision made twice. */
const SCALE_FIELDS: Array<{ key: ScaleKey; label: string; low: string; high: string }> = [
  { key: "radiusScale", label: "Corner Radius", low: "Square", high: "Rounded" },
  { key: "spacingScale", label: "Spacing", low: "Compact", high: "Spacious" },
  { key: "shadowScale", label: "Shadows", low: "Flat", high: "Elevated" },
  { key: "borderScale", label: "Border Thickness", low: "Thin", high: "Strong" },
];
const FONT_GROUPS = (["sans", "serif", "mono"] as FontCategory[]).map((category) => ({ category, fonts: FONT_CHOICES.filter((font) => font.category === category) }));
const TYPOGRAPHY_FIELDS: Array<{ key: keyof TypographySettingsInput; label: string; hint: string }> = [
  { key: "headingFont", label: "Heading font", hint: "Used for every heading on your website." },
  { key: "bodyFont", label: "Body font", hint: "Used for paragraphs, lists, labels and navigation." },
];

function SaveIndicator({ status, error }: { status: SaveStatus; error?: string }) {
  if (status === "Idle") return null;
  return <span className={`save-indicator save-${status.toLowerCase()}`} title={error}>{status === "Saving" ? <LoaderCircle className="spin" size={14} /> : status === "Error" ? <CircleAlert size={14} /> : <Check size={14} />}{status}{error ? <span className="sr-only">: {error}</span> : null}</span>;
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const pickerValue = /^#[0-9A-Fa-f]{6}$/.test(value) ? value : "#000000";
  return <label className="color-field"><span>{label}</span><div><input type="color" value={pickerValue} onChange={(event) => onChange(event.target.value.toUpperCase())} aria-label={`${label} color picker`} /><input className="input" value={value} onChange={(event) => onChange(event.target.value.toUpperCase())} maxLength={7} aria-label={`${label} hex color`} /></div></label>;
}

/** Key-order-independent identity for a theme, so "which preset is this" is stable. */
function canonicalTheme(theme: ThemeSettingsInput) {
  const colors = (tokens: SemanticColorTokens) => COLOR_FIELDS.map(({ key }) => `${key}:${tokens[key]}`).join(",");
  return [
    colors(theme.lightTokens), colors(theme.darkTokens),
    ...SCALE_FIELDS.map(({ key }) => `${key}:${theme[key]}`),
    `fontScale:${theme.fontScale}`,
    ...TYPOGRAPHY_FIELDS.map(({ key }) => `${key}:${theme.typography[key]}`),
  ].join("|");
}

const fontLabel = (id: string) => FONT_CHOICES.find((font) => font.id === id)?.label ?? id;

/** A curated select: the fonts are grouped by category so the list stays readable. */
function FontField({ label, hint, value, onChange }: { label: string; hint: string; value: string; onChange: (value: string) => void }) {
  return <Select label={label} hint={hint} value={value} onChange={(event) => onChange(event.target.value)}>
    {FONT_GROUPS.map(({ category, fonts }) => <optgroup key={category} label={FONT_CATEGORY_LABELS[category]}>
      {fonts.map((font) => <option key={font.id} value={font.id}>{font.label}</option>)}
    </optgroup>)}
  </Select>;
}

function ScaleField({ label, low, high, value, onChange }: { label: string; low: string; high: string; value: number; onChange: (value: number) => void }) {
  return <label className="scale-field"><span className="field-label">{label}</span><input type="range" min="0" max="100" step="1" value={value} onChange={(event) => onChange(Number(event.target.value))} /><span className="scale-endpoints"><small>{low}</small><small>{high}</small></span></label>;
}

export function ThemeEditor({ projectId, initialBrand, initialTheme, recoveredFromInvalidState = false }: {
  projectId: string;
  initialBrand: BrandSettingsInput & { revision: number };
  initialTheme: ThemeSettingsInput & { revision: number };
  recoveredFromInvalidState?: boolean;
}) {
  const [brand, setBrand] = useState<BrandSettingsInput>({ companyName: initialBrand.companyName, companyDescription: initialBrand.companyDescription, brandNotes: initialBrand.brandNotes });
  const [theme, setTheme] = useState<ThemeSettingsInput>({ lightTokens: initialTheme.lightTokens, darkTokens: initialTheme.darkTokens, radiusScale: initialTheme.radiusScale, spacingScale: initialTheme.spacingScale, shadowScale: initialTheme.shadowScale, fontScale: initialTheme.fontScale, borderScale: initialTheme.borderScale, typography: { ...initialTheme.typography } });
  const [mode, setMode] = useState<"light" | "dark">("light");
  // A staged preset is a preview, never a save: it changes what the preview column
  // paints and nothing else until Apply is pressed.
  const [stagedPreset, setStagedPreset] = useState<ThemePreset | null>(null);
  const [brandStatus, setBrandStatus] = useState<SaveStatus>("Idle");
  const [themeStatus, setThemeStatus] = useState<SaveStatus>("Idle");
  const [brandError, setBrandError] = useState<string | undefined>();
  const [themeError, setThemeError] = useState<string | undefined>(recoveredFromInvalidState ? "Stored theme values were invalid. Safe defaults are shown; edit or reset to recover." : undefined);
  const brandRef = useRef(brand); const themeRef = useRef(theme);
  const brandRevision = useRef(initialBrand.revision); const themeRevision = useRef(initialTheme.revision);
  const brandSaving = useRef(false); const themeSaving = useRef(false);
  const brandDirty = useRef(false); const themeDirty = useRef(false);
  const initialBrandRender = useRef(true); const initialThemeRender = useRef(true);
  const suppressThemeSave = useRef(false);

  const flushBrand = useCallback(async () => {
    if (brandSaving.current || !brandDirty.current) return;
    brandSaving.current = true;
    let failed = false;
    while (brandDirty.current) {
      brandDirty.current = false;
      const snapshot = brandRef.current;
      const result = await saveBrandAction({ projectId, expectedRevision: brandRevision.current, brand: snapshot });
      if (result.ok) { brandRevision.current = result.revision; setBrandError(undefined); if (JSON.stringify(snapshot) !== JSON.stringify(brandRef.current)) brandDirty.current = true; }
      else if (result.stale && result.revision) { brandRevision.current = result.revision; brandDirty.current = true; }
      else { failed = true; setBrandError(result.error); setBrandStatus("Error"); break; }
    }
    brandSaving.current = false;
    if (!brandDirty.current && !failed) setBrandStatus("Saved");
  }, [projectId]);

  const flushTheme = useCallback(async () => {
    if (themeSaving.current || !themeDirty.current) return;
    themeSaving.current = true;
    let failed = false;
    while (themeDirty.current) {
      themeDirty.current = false;
      const snapshot = themeRef.current;
      const result = await saveThemeAction({ projectId, expectedRevision: themeRevision.current, theme: snapshot });
      if (result.ok) { themeRevision.current = result.revision; setThemeError(undefined); if (JSON.stringify(snapshot) !== JSON.stringify(themeRef.current)) themeDirty.current = true; }
      else if (result.stale && result.revision) { themeRevision.current = result.revision; themeDirty.current = true; }
      else { failed = true; setThemeError(result.error); setThemeStatus("Error"); break; }
    }
    themeSaving.current = false;
    if (!themeDirty.current && !failed) setThemeStatus("Saved");
  }, [projectId]);

  useEffect(() => { brandRef.current = brand; if (initialBrandRender.current) { initialBrandRender.current = false; return; } brandDirty.current = true; const timer = window.setTimeout(() => void flushBrand(), 700); return () => window.clearTimeout(timer); }, [brand, flushBrand]);
  useEffect(() => { themeRef.current = theme; if (initialThemeRender.current) { initialThemeRender.current = false; return; } if (suppressThemeSave.current) { suppressThemeSave.current = false; return; } themeDirty.current = true; const timer = window.setTimeout(() => void flushTheme(), 700); return () => window.clearTimeout(timer); }, [theme, flushTheme]);

  const updateBrand = (patch: Partial<BrandSettingsInput>) => { const next = { ...brandRef.current, ...patch }; brandRef.current = next; setBrand(next); setBrandStatus("Saving"); };
  const updateTheme = (patch: Partial<ThemeSettingsInput>) => { const next = { ...themeRef.current, ...patch }; themeRef.current = next; setTheme(next); setThemeStatus("Saving"); };
  const updateColor = (key: keyof SemanticColorTokens, value: string) => updateTheme({ [mode === "light" ? "lightTokens" : "darkTokens"]: { ...theme[mode === "light" ? "lightTokens" : "darkTokens"], [key]: value } });
  const previewTheme = stagedPreset?.theme ?? theme;
  const resolved = useMemo(() => resolveProjectDesignTokens(previewTheme), [previewTheme]);
  const previewStyle = projectThemeCssVariables(resolved, mode) as CSSProperties;
  // Which preset the saved theme currently equals, if any. Editing any value after
  // applying one simply stops matching, which is the honest answer.
  const appliedPresetId = useMemo(() => {
    const current = canonicalTheme(theme);
    return THEME_PRESETS.find((preset) => canonicalTheme(preset.theme) === current)?.id ?? null;
  }, [theme]);
  function applyPreset(preset: ThemePreset) { setStagedPreset(null); updateTheme(preset.theme); }

  async function resetTheme() {
    setThemeStatus("Saving");
    const result = await resetThemeAction({ projectId, expectedRevision: themeRevision.current });
    if (!result.ok) { setThemeError(result.error); setThemeStatus("Error"); return; }
    themeRevision.current = result.revision; suppressThemeSave.current = true; themeRef.current = result.value; setTheme(result.value); setThemeError(undefined); setThemeStatus("Saved");
  }

  return <div className="theme-editor-layout"><div className="theme-settings-column">
    <Section title="Your company" description="What the agent should say about you, and how the website should feel." actions={<SaveIndicator status={brandStatus} error={brandError} />}><div className="stack"><Input label="Company name" value={brand.companyName} onChange={(event) => updateBrand({ companyName: event.target.value })} maxLength={120} /><Textarea label="Company description" value={brand.companyDescription ?? ""} onChange={(event) => updateBrand({ companyDescription: event.target.value })} maxLength={2000} rows={4} /><Textarea label="Brand notes" value={brand.brandNotes ?? ""} onChange={(event) => updateBrand({ brandNotes: event.target.value })} maxLength={4000} rows={4} hint="Describe how your brand should feel — professional, playful, minimal, luxurious, technical." /></div></Section>
    {/* Visual styles sit above the individual controls: the fastest route to a
        coherent look is picking one, and everything below stays editable
        afterwards. A style is a visual language, never a page layout. */}
    <Section title="Visual styles" description="Colours, typography, corners, spacing and surfaces. A style changes how your site looks, not its page layout or section order. Pick one to preview it, then apply and keep editing.">
      <ThemePresetPicker
        stagedPresetId={stagedPreset?.id ?? null}
        appliedPresetId={appliedPresetId}
        mode={mode}
        onMode={setMode}
        onStage={setStagedPreset}
        onClear={() => setStagedPreset(null)}
        onApply={applyPreset}
      />
    </Section>
    <Section title="Colours" description="Every page uses these. Light and dark are set separately." actions={<SaveIndicator status={themeStatus} error={themeError} />}><SegmentedControl label="Colours to edit" value={mode} onChange={setMode} options={[{ value: "light", label: "Light", icon: <Sun size={13} /> }, { value: "dark", label: "Dark", icon: <Moon size={13} /> }]} />{themeError ? <p className="form-error" role="alert">{themeError}</p> : null}<div className="color-grid">{COLOR_FIELDS.map((field) => <ColorField key={field.key} label={field.label} value={theme[mode === "light" ? "lightTokens" : "darkTokens"][field.key]} onChange={(value) => updateColor(field.key, value)} />)}</div></Section>
    {/* Typography is a design decision, not a shape control: which faces the site is set
        in, and how big. It sits with the colours rather than behind a disclosure. */}
    <Section title="Typography" description="The typefaces every generated page uses. Headings and body text are set separately." actions={<SaveIndicator status={themeStatus} error={themeError} />}>
      <div className="stack">
        {TYPOGRAPHY_FIELDS.map((field) => <FontField key={field.key} label={field.label} hint={field.hint} value={theme.typography[field.key]} onChange={(value) => updateTheme({ typography: { ...themeRef.current.typography, [field.key]: value } })} />)}
        <ScaleField label="Font Scale" low="Smaller" high="Larger" value={theme.fontScale} onChange={(value) => updateTheme({ fontScale: value })} />
      </div>
    </Section>
    {/* The remaining scales are the lower-level controls: real, kept, and out of the
        way until someone wants them. A preset already sets all of them. */}
    <Section>
      <Disclosure title="Shape & spacing" hint="Corners, spacing, shadows, borders">
        <div className="scale-list">{SCALE_FIELDS.map((field) => <ScaleField key={field.key} label={field.label} low={field.low} high={field.high} value={theme[field.key]} onChange={(value) => updateTheme({ [field.key]: value })} />)}</div>
      </Disclosure>
    </Section>
    <Section><div className="reset-row"><div><strong>Start the design again</strong><p>Puts every colour, font and style control back to the Canvas defaults. Your company details are kept.</p></div><ConfirmationDialog title="Reset the design?" triggerLabel="Reset design" description="Light and dark colours, both fonts, and every style control return to their defaults. Your company name, description and notes are kept." action={<Button type="button" variant="danger" icon={<RotateCcw size={15} />} onClick={() => void resetTheme()}>Reset the design</Button>} /></div></Section>
  </div>
  <aside className="theme-preview-column"><div className="preview-heading"><div><h2>{brand.companyName || "Your company"}</h2><p className="text-sm text-muted">A sample of how these settings look. It shows the design system, not a page layout — the structure of each page is designed for that page.</p><p className="text-sm text-muted">Headings: {fontLabel(previewTheme.typography.headingFont)} · Body: {fontLabel(previewTheme.typography.bodyFont)}</p></div><SegmentedControl label="Preview appearance" value={mode} onChange={setMode} options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} /></div><div className="project-theme-preview" style={previewStyle}><nav><strong>{brand.companyName || "Company"}</strong><span>About&nbsp;&nbsp; Work&nbsp;&nbsp; Contact</span></nav><main><span className="preview-badge">New perspective</span><h3>Build something great</h3><p>{brand.companyDescription || "A sample heading and supporting body copy that demonstrates your project’s typography and colors."}</p><div className="preview-buttons"><button>Primary button</button><button>Secondary button</button></div><section><h4>Example card</h4><p>This surface demonstrates your spacing, borders, radius, shadows, and muted text.</p><label>Example input<input placeholder="Type something…" /></label><a href="#preview">Text link</a></section></main></div></aside>
  </div>;
}
