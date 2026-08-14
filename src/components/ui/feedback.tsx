import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

const TONE_ICON = {
  neutral: Info,
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
} as const;

/**
 * A message about the surface it sits in.
 *
 * Tone is carried by an icon and wording as well as colour, so the meaning
 * survives for anyone who cannot separate the two. Danger and warning are
 * announced; info and success are not, because they interrupt nothing.
 */
export function InlineAlert({ tone = "neutral", title, action, children }: {
  tone?: Tone; title?: string; action?: ReactNode; children?: ReactNode;
}) {
  const Icon = TONE_ICON[tone];
  return <div className={`alert alert-${tone}`} role={tone === "danger" || tone === "warning" ? "alert" : undefined}>
    <Icon size={16} aria-hidden="true" />
    <div className="alert-body">
      {title ? <strong>{title}</strong> : null}
      {children ? <p>{children}</p> : null}
    </div>
    {action}
  </div>;
}

/** A short, coloured label for a value that has states. */
export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

/**
 * A live state with a dot and a word. The word is not optional: state is never
 * communicated by colour alone.
 */
export function StatusIndicator({ tone = "neutral", busy = false, children, live }: {
  tone?: Tone; busy?: boolean; children: ReactNode; live?: boolean;
}) {
  return <span className="status-indicator" role={live ? "status" : undefined}>
    <span className={`status-dot ${busy ? "status-dot-busy" : `status-dot-${tone}`}`} aria-hidden="true" />
    <span className="truncate">{children}</span>
  </span>;
}

/** A removable token: a selected image, a filter, the element being edited. */
export function Chip({ accent = false, icon, onRemove, removeLabel, children }: {
  accent?: boolean; icon?: ReactNode; onRemove?: () => void; removeLabel?: string; children: ReactNode;
}) {
  return <span className={`chip ${accent ? "chip-accent" : ""}`.trim()}>
    {icon}
    <span>{children}</span>
    {onRemove ? <button type="button" className="chip-remove" aria-label={removeLabel ?? "Remove"} onClick={onRemove}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
    </button> : null}
  </span>;
}
