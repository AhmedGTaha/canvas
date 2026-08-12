import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";

type SharedProps = { label: string; error?: string; hint?: string };

export function Input({ label, error, hint, id, ...props }: InputHTMLAttributes<HTMLInputElement> & SharedProps) {
  const inputId = id ?? props.name;
  const errorId = error ? `${inputId}-error` : undefined;
  return <label className="field" htmlFor={inputId}>
    <span className="field-label">{label}</span>
    <input id={inputId} className="input" aria-invalid={Boolean(error)} aria-describedby={errorId} {...props} />
    {hint && !error ? <span className="field-hint">{hint}</span> : null}
    {error ? <span className="field-error" id={errorId}>{error}</span> : null}
  </label>;
}

export function Textarea({ label, error, hint, id, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & SharedProps) {
  const inputId = id ?? props.name;
  const errorId = error ? `${inputId}-error` : undefined;
  return <label className="field" htmlFor={inputId}>
    <span className="field-label">{label}</span>
    <textarea id={inputId} className="textarea" aria-invalid={Boolean(error)} aria-describedby={errorId} {...props} />
    {hint && !error ? <span className="field-hint">{hint}</span> : null}
    {error ? <span className="field-error" id={errorId}>{error}</span> : null}
  </label>;
}
