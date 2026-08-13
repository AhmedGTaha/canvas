import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

type SharedProps = { label: string; error?: string; hint?: ReactNode };

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
function Field({ label, error, hint, inputId, children }: SharedProps & { inputId: string; children: (describedBy: string | undefined) => ReactNode }) {
  const generated = useId();
  const hintId = `${generated}-hint`;
  const errorId = `${generated}-error`;
  const describedBy = error ? errorId : hint ? hintId : undefined;
  return <div className="field">
    <label className="field-label" htmlFor={inputId}>{label}</label>
    {children(describedBy)}
    {hint && !error ? <span className="field-hint" id={hintId}>{hint}</span> : null}
    {error ? <span className="field-error" id={errorId} role="alert">{error}</span> : null}
  </div>;
}

export function Input({ label, error, hint, id, ...props }: InputHTMLAttributes<HTMLInputElement> & SharedProps) {
  const generated = useId();
  const inputId = id ?? generated;
  return <Field label={label} error={error} hint={hint} inputId={inputId}>
    {(describedBy) => <input id={inputId} className="input" aria-invalid={Boolean(error)} aria-describedby={describedBy} {...props} />}
  </Field>;
}

export function Textarea({ label, error, hint, id, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & SharedProps) {
  const generated = useId();
  const inputId = id ?? generated;
  return <Field label={label} error={error} hint={hint} inputId={inputId}>
    {(describedBy) => <textarea id={inputId} className="textarea" aria-invalid={Boolean(error)} aria-describedby={describedBy} {...props} />}
  </Field>;
}

export function Select({ label, error, hint, id, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & SharedProps) {
  const generated = useId();
  const inputId = id ?? generated;
  return <Field label={label} error={error} hint={hint} inputId={inputId}>
    {(describedBy) => <select id={inputId} className="input" aria-invalid={Boolean(error)} aria-describedby={describedBy} {...props}>{children}</select>}
  </Field>;
}
