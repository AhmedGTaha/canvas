"use client";

import { Search, X } from "lucide-react";
import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

type SharedProps = { label: string; error?: string; hint?: ReactNode; optional?: boolean };

/**
 * Field wrapper with a correct accessible name. The label element holds only the field
 * name; hints and validation messages are associated through aria-describedby so they
 * are announced as description, never folded into the name.
 *
 * The control's id is generated per instance rather than derived from its type or
 * its form name. Two unnamed fields on one screen — Brand's company description
 * and brand notes, for instance — would otherwise share the literal id
 * "textarea", and every label but the first would point at the wrong control,
 * leaving the rest with no accessible name at all.
 */
export function Field({ label, error, hint, optional, inputId, children }: SharedProps & { inputId: string; children: (describedBy: string | undefined) => ReactNode }) {
  const generated = useId();
  const hintId = `${generated}-hint`;
  const errorId = `${generated}-error`;
  const describedBy = error ? errorId : hint ? hintId : undefined;
  return <div className="field">
    <label className="field-label" htmlFor={inputId}>{label}{optional ? <span className="field-optional">Optional</span> : null}</label>
    {children(describedBy)}
    {hint && !error ? <span className="field-hint" id={hintId}>{hint}</span> : null}
    {error ? <span className="field-error" id={errorId} role="alert">{error}</span> : null}
  </div>;
}

export function Input({ label, error, hint, optional, id, ...props }: InputHTMLAttributes<HTMLInputElement> & SharedProps) {
  const generated = useId();
  const inputId = id ?? generated;
  return <Field label={label} error={error} hint={hint} optional={optional} inputId={inputId}>
    {(describedBy) => <input id={inputId} className="input" aria-invalid={Boolean(error)} aria-describedby={describedBy} {...props} />}
  </Field>;
}

export function Textarea({ label, error, hint, optional, id, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & SharedProps) {
  const generated = useId();
  const inputId = id ?? generated;
  return <Field label={label} error={error} hint={hint} optional={optional} inputId={inputId}>
    {(describedBy) => <textarea id={inputId} className="textarea" aria-invalid={Boolean(error)} aria-describedby={describedBy} {...props} />}
  </Field>;
}

export function Select({ label, error, hint, optional, id, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & SharedProps) {
  const generated = useId();
  const inputId = id ?? generated;
  return <Field label={label} error={error} hint={hint} optional={optional} inputId={inputId}>
    {(describedBy) => <select id={inputId} className="input" aria-invalid={Boolean(error)} aria-describedby={describedBy} {...props}>{children}</select>}
  </Field>;
}

/** A checkbox with its explanation, so the label stays the label. */
export function Checkbox({ label, description, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; description?: string }) {
  const id = useId();
  return <div className="choice">
    <input id={id} type="checkbox" {...props} />
    <label className="choice-text" htmlFor={id}><span>{label}</span>{description ? <small>{description}</small> : null}</label>
  </div>;
}

/** An on/off setting that applies immediately. Use a checkbox inside a form. */
export function Switch({ label, description, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; description?: string }) {
  const id = useId();
  return <div className="switch">
    <label className="choice-text" htmlFor={id}><span>{label}</span>{description ? <small>{description}</small> : null}</label>
    <span className="switch-input">
      <input id={id} type="checkbox" role="switch" {...props} />
      <span className="switch-control" aria-hidden="true" />
    </span>
  </div>;
}

/**
 * Search input that owns its icon and its clear control.
 *
 * The clear button only exists once there is something to clear, so the field
 * does not carry a permanently dead affordance.
 */
export function SearchField({ label, value, onValueChange, placeholder, size = "md", className = "" }: {
  label: string; value: string; onValueChange: (value: string) => void; placeholder?: string; size?: "md" | "lg"; className?: string;
}) {
  return <div className={`search-field ${size === "lg" ? "search-field-lg" : ""} ${className}`.trim()}>
    <Search size={14} aria-hidden="true" />
    <input type="search" aria-label={label} placeholder={placeholder ?? label} value={value} onChange={(event) => onValueChange(event.target.value)} />
    {value ? <button type="button" className="icon-button icon-button-sm" aria-label={`Clear ${label.toLowerCase()}`} onClick={() => onValueChange("")}><X size={13} /></button> : null}
  </div>;
}

/** A titled group of fields. Settings are grouped by structure, not by cards. */
export function FormSection({ title, description, actions, children }: { title?: string; description?: string; actions?: ReactNode; children: ReactNode }) {
  return <section className="form-section">
    {title ? <div className="section-head"><div className="form-section-head"><h3>{title}</h3>{description ? <p>{description}</p> : null}</div>{actions ? <div className="section-head-actions">{actions}</div> : null}</div> : null}
    <div className="form-fields">{children}</div>
  </section>;
}

/** The one row of actions that ends a form. */
export function FormActions({ children, split = false }: { children: ReactNode; split?: boolean }) {
  return <div className={`form-actions ${split ? "form-actions-split" : ""}`.trim()}>{children}</div>;
}
