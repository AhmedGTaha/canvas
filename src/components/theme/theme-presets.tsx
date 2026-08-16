"use client";

import { Check, Moon, Sun, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { THEME_PRESETS, type ThemePreset } from "@/domain/theme/presets";
import type { SemanticColorTokens, ThemeSettingsInput } from "@/domain/theme/schemas";

const SWATCHES: Array<keyof SemanticColorTokens> = ["primary", "accent", "surface", "background", "border"];

/**
 * The ready-made theme picker.
 *
 * Choosing a preset does not change the project: it stages the preset, and the
 * live preview beside this list starts showing it immediately, so the decision is
 * made by looking rather than by reading colour names. Applying is a separate,
 * explicit act, and it goes through the same theme save path as moving one slider
 * — same revision check, same autosave, same history. "Keep editing" puts the
 * staged preset back, so browsing costs nothing.
 */
export function ThemePresetPicker({ stagedPresetId, appliedPresetId, mode, onMode, onStage, onClear, onApply }: {
  stagedPresetId: string | null;
  appliedPresetId: string | null;
  mode: "light" | "dark";
  onMode: (mode: "light" | "dark") => void;
  onStage: (preset: ThemePreset) => void;
  onClear: () => void;
  onApply: (preset: ThemePreset) => void;
}) {
  const staged = THEME_PRESETS.find((preset) => preset.id === stagedPresetId) ?? null;
  return <div className="preset-picker">
    <ul className="preset-grid">
      {THEME_PRESETS.map((preset) => {
        const selected = preset.id === stagedPresetId;
        const applied = preset.id === appliedPresetId && !stagedPresetId;
        return <li key={preset.id}>
          <button
            type="button"
            className="preset-card"
            aria-pressed={selected}
            onClick={() => (selected ? onClear() : onStage(preset))}
          >
            <PresetSwatch theme={preset.theme} mode={mode} />
            <span className="preset-card-body">
              <strong>{preset.name}{applied ? <span className="preset-applied"><Check size={12} aria-hidden="true" />In use</span> : null}</strong>
              <small>{preset.description}</small>
            </span>
          </button>
        </li>;
      })}
    </ul>
    <div className="preset-actions" role="group" aria-label="Theme preset actions">
      <button type="button" className="preset-mode" onClick={() => onMode(mode === "light" ? "dark" : "light")} aria-label={`Preview presets in ${mode === "light" ? "dark" : "light"} mode`}>
        {mode === "light" ? <Sun size={13} aria-hidden="true" /> : <Moon size={13} aria-hidden="true" />}
        {mode === "light" ? "Light" : "Dark"}
      </button>
      <span className="preset-actions-note" role="status">
        {staged ? `Previewing ${staged.name}. Nothing is saved until you apply it.` : "Pick a theme to preview it here."}
      </span>
      <Button type="button" variant="secondary" size="sm" icon={<Undo2 size={14} />} disabled={!staged} onClick={onClear}>Keep editing</Button>
      <Button type="button" variant="primary" size="sm" icon={<Check size={14} />} disabled={!staged} onClick={() => staged && onApply(staged)}>Apply theme</Button>
    </div>
  </div>;
}

/** A compact, honest sample: page background, a surface, and the accent colours on it. */
function PresetSwatch({ theme, mode }: { theme: ThemeSettingsInput; mode: "light" | "dark" }) {
  const tokens = mode === "light" ? theme.lightTokens : theme.darkTokens;
  return <span className="preset-swatch" style={{ background: tokens.background, borderColor: tokens.border }} aria-hidden="true">
    <span className="preset-swatch-bar" style={{ background: tokens.surface, borderColor: tokens.border }}>
      <span style={{ background: tokens.text }} />
      <span style={{ background: tokens.mutedText }} />
    </span>
    <span className="preset-swatch-dots">
      {SWATCHES.map((key) => <span key={key} style={{ background: tokens[key], borderColor: tokens.border }} />)}
    </span>
  </span>;
}
