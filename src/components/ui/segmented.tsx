"use client";

import { useRef, type ReactNode } from "react";

export type SegmentedOption<T extends string> = { value: T; label: string; icon?: ReactNode };

/**
 * A choice between a few mutually exclusive views of the same thing — light or
 * dark, desktop or phone. Pressed state, not a tab: the body underneath does
 * not change identity, only its presentation.
 */
export function SegmentedControl<T extends string>({ label, value, options, size = "md", onChange }: {
  label: string; value: T; options: Array<SegmentedOption<T>>; size?: "md" | "lg"; onChange: (value: T) => void;
}) {
  return <div className={`segmented ${size === "lg" ? "segmented-lg" : ""}`.trim()} role="group" aria-label={label}>
    {options.map((option) => <button
      key={option.value}
      type="button"
      aria-pressed={value === option.value}
      title={option.label}
      onClick={() => onChange(option.value)}
    >{option.icon}{option.label}</button>)}
  </div>;
}

/**
 * Tabs over one body of content, with the arrow-key behaviour the role
 * implies: one tab stop for the set, arrows move between tabs.
 */
export function Tabs<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  function onKeyDown(event: React.KeyboardEvent) {
    const index = options.findIndex((option) => option.value === value);
    const next = event.key === "ArrowRight" ? index + 1 : event.key === "ArrowLeft" ? index - 1 : event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    const position = (next + options.length) % options.length;
    const target = options[position];
    if (!target) return;
    onChange(target.value);
    list.current?.querySelectorAll<HTMLButtonElement>("[role=tab]")[position]?.focus();
  }
  return <div className="tabs" role="tablist" aria-label={label} ref={list} onKeyDown={onKeyDown}>
    {options.map((option) => <button
      key={option.value}
      type="button"
      role="tab"
      id={`tab-${option.value}`}
      aria-selected={value === option.value}
      aria-controls={`tabpanel-${option.value}`}
      tabIndex={value === option.value ? 0 : -1}
      onClick={() => onChange(option.value)}
    >{option.label}</button>)}
  </div>;
}

export function TabPanel<T extends string>({ value, children }: { value: T; children: ReactNode }) {
  return <div role="tabpanel" id={`tabpanel-${value}`} aria-labelledby={`tab-${value}`} tabIndex={0}>{children}</div>;
}
