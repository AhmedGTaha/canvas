"use client";

import { Check, CircleAlert, LoaderCircle, Moon, RotateCcw, Sun } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { resetThemeAction, saveBrandAction, saveThemeAction } from "@/app/actions/theme";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Input, Textarea } from "@/components/ui/form-controls";
import { projectThemeCssVariables, resolveProjectDesignTokens } from "@/domain/theme/resolver";
import type { BrandSettingsInput, SemanticColorTokens, ThemeSettingsInput } from "@/domain/theme/schemas";

type SaveStatus = "Saved" | "Saving" | "Error";
const COLOR_FIELDS: Array<{ key: keyof SemanticColorTokens; label: string }> = [
  { key: "primary", label: "Primary" }, { key: "secondary", label: "Secondary" }, { key: "accent", label: "Accent" },
  { key: "background", label: "Background" }, { key: "surface", label: "Surface" }, { key: "text", label: "Text" },
  { key: "mutedText", label: "Muted Text" }, { key: "border", label: "Border" },
];
const SCALE_FIELDS: Array<{ key: Exclude<keyof ThemeSettingsInput, "lightTokens" | "darkTokens">; label: string; low: string; high: string }> = [
  { key: "radiusScale", label: "Corner Radius", low: "Square", high: "Rounded" },
  { key: "spacingScale", label: "Spacing", low: "Compact", high: "Spacious" },
  { key: "shadowScale", label: "Shadows", low: "Flat", high: "Elevated" },
  { key: "fontScale", label: "Font Scale", low: "Smaller", high: "Larger" },
  { key: "borderScale", label: "Border Thickness", low: "Thin", high: "Strong" },
];

function SaveIndicator({ status, error }: { status: SaveStatus; error?: string }) {
  return <span className={`save-indicator save-${status.toLowerCase()}`} title={error}>{status === "Saving" ? <LoaderCircle className="spin" size={14} /> : status === "Error" ? <CircleAlert size={14} /> : <Check size={14} />}{status}{error ? <span className="sr-only">: {error}</span> : null}</span>;
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const pickerValue = /^#[0-9A-Fa-f]{6}$/.test(value) ? value : "#000000";
  return <label className="color-field"><span>{label}</span><div><input type="color" value={pickerValue} onChange={(event) => onChange(event.target.value.toUpperCase())} aria-label={`${label} color picker`} /><input className="input" value={value} onChange={(event) => onChange(event.target.value.toUpperCase())} maxLength={7} aria-label={`${label} hex color`} /></div></label>;
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
  const [theme, setTheme] = useState<ThemeSettingsInput>({ lightTokens: initialTheme.lightTokens, darkTokens: initialTheme.darkTokens, radiusScale: initialTheme.radiusScale, spacingScale: initialTheme.spacingScale, shadowScale: initialTheme.shadowScale, fontScale: initialTheme.fontScale, borderScale: initialTheme.borderScale });
  const [mode, setMode] = useState<"light" | "dark">("light");
  const [brandStatus, setBrandStatus] = useState<SaveStatus>("Saved");
  const [themeStatus, setThemeStatus] = useState<SaveStatus>("Saved");
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
  const resolved = useMemo(() => resolveProjectDesignTokens(theme), [theme]);
  const previewStyle = projectThemeCssVariables(resolved, mode) as CSSProperties;

  async function resetTheme() {
    setThemeStatus("Saving");
    const result = await resetThemeAction({ projectId, expectedRevision: themeRevision.current });
    if (!result.ok) { setThemeError(result.error); setThemeStatus("Error"); return; }
    themeRevision.current = result.revision; suppressThemeSave.current = true; themeRef.current = result.value; setTheme(result.value); setThemeError(undefined); setThemeStatus("Saved");
  }

  return <div className="theme-editor-layout"><div className="theme-settings-column">
    <Card><div className="settings-title"><div><p className="eyebrow">Identity</p><h2>Brand</h2></div><SaveIndicator status={brandStatus} error={brandError} /></div><div className="stack"><Input label="Company name" value={brand.companyName} onChange={(event) => updateBrand({ companyName: event.target.value })} maxLength={120} /><Textarea label="Company description" value={brand.companyDescription ?? ""} onChange={(event) => updateBrand({ companyDescription: event.target.value })} maxLength={2000} rows={4} /><Textarea label="Brand notes" value={brand.brandNotes ?? ""} onChange={(event) => updateBrand({ brandNotes: event.target.value })} maxLength={4000} rows={4} hint="Describe how your brand should feel, such as professional, playful, minimal, luxurious, or technical." /></div></Card>
    <Card><div className="settings-title"><div><p className="eyebrow">Theme</p><h2>Colors</h2></div><SaveIndicator status={themeStatus} error={themeError} /></div><div className="segmented" role="group" aria-label="Theme color mode"><button type="button" aria-label="Edit light colors" aria-pressed={mode === "light"} className={mode === "light" ? "active" : ""} onClick={() => setMode("light")}><Sun size={14} />Light</button><button type="button" aria-label="Edit dark colors" aria-pressed={mode === "dark"} className={mode === "dark" ? "active" : ""} onClick={() => setMode("dark")}><Moon size={14} />Dark</button></div>{themeError ? <p className="form-error" role="alert">{themeError}</p> : null}<div className="color-grid">{COLOR_FIELDS.map((field) => <ColorField key={field.key} label={field.label} value={theme[mode === "light" ? "lightTokens" : "darkTokens"][field.key]} onChange={(value) => updateColor(field.key, value)} />)}</div></Card>
    <Card><div className="settings-title"><div><p className="eyebrow">System</p><h2>Style</h2></div></div><div className="scale-list">{SCALE_FIELDS.map((field) => <ScaleField key={field.key} label={field.label} low={field.low} high={field.high} value={theme[field.key]} onChange={(value) => updateTheme({ [field.key]: value })} />)}</div><div className="reset-row"><div><strong>Restore visual defaults</strong><p>Resets both color modes and all style controls. Brand details stay unchanged.</p></div><ConfirmationDialog title="Reset theme?" triggerLabel="Reset theme" description="Both light and dark colors and all style controls will return to their defaults. Company identity will be preserved." action={<Button type="button" variant="danger" onClick={() => void resetTheme()}><RotateCcw size={15} />Reset theme and keep my brand</Button>} /></div></Card>
  </div>
  <aside className="theme-preview-column"><div className="preview-heading"><div><p className="eyebrow">Live preview</p><h2>{brand.companyName || "Your company"}</h2></div><div className="segmented compact" role="group" aria-label="Preview mode"><button type="button" aria-label="Preview in light mode" aria-pressed={mode === "light"} className={mode === "light" ? "active" : ""} onClick={() => setMode("light")}>Light</button><button type="button" aria-label="Preview in dark mode" aria-pressed={mode === "dark"} className={mode === "dark" ? "active" : ""} onClick={() => setMode("dark")}>Dark</button></div></div><div className="project-theme-preview" style={previewStyle}><nav><strong>{brand.companyName || "Company"}</strong><span>About&nbsp;&nbsp; Work&nbsp;&nbsp; Contact</span></nav><main><span className="preview-badge">New perspective</span><h3>Build something great</h3><p>{brand.companyDescription || "A sample heading and supporting body copy that demonstrates your project’s typography and colors."}</p><div className="preview-buttons"><button>Primary button</button><button>Secondary button</button></div><section><h4>Example card</h4><p>This surface demonstrates your spacing, borders, radius, shadows, and muted text.</p><label>Example input<input placeholder="Type something…" /></label><a href="#preview">Text link</a></section></main></div></aside>
  </div>;
}
