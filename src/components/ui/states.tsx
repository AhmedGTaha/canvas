import { CircleAlert, FolderOpen, LoaderCircle } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

type StateSize = "default" | "compact" | "inline";

function stateClass(size: StateSize, tone?: "danger") {
  return ["state", size !== "default" && `state-${size}`, tone && `state-${tone}`].filter(Boolean).join(" ");
}

/**
 * Empty, loading and error all render the same anatomy, so a surface changing
 * state does not change shape under the user.
 *
 * An empty state names what to do next and carries the control that does it;
 * an error says what happened and what the reader can do about it. Neither
 * ever shows an internal identifier, a stack or a provider name.
 */
export function EmptyState({ icon, title, description, action, size = "default" }: {
  icon?: ReactNode; title: string; description?: string; action?: ReactNode; size?: StateSize;
}) {
  return <div className={stateClass(size)}>
    <span className="state-icon">{icon ?? <FolderOpen size={19} />}</span>
    <h2>{title}</h2>
    {description ? <p>{description}</p> : null}
    {action ? <div className="state-actions">{action}</div> : null}
  </div>;
}

export function LoadingState({ label = "Loading…", size = "default" }: { label?: string; size?: StateSize }) {
  return <div className={`${stateClass(size)} state-loading`} role="status">
    <LoaderCircle className="spin" size={18} aria-hidden="true" />
    <span>{label}</span>
  </div>;
}

export function ErrorState({ title = "That didn't work", description, retry, size = "default" }: {
  title?: string; description: string; retry?: ReactNode; size?: StateSize;
}) {
  return <div className={stateClass(size, "danger")} role="alert">
    <span className="state-icon"><CircleAlert size={19} /></span>
    <h2>{title}</h2>
    <p>{description}</p>
    {retry ? <div className="state-actions">{retry}</div> : null}
  </div>;
}

/**
 * A placeholder with the shape of the content that is coming, so the layout
 * does not jump when it arrives.
 */
export function Skeleton({ width, height = 10, radius, className = "" }: { width?: number | string; height?: number; radius?: number; className?: string }) {
  const style: CSSProperties = { width: width ?? "100%", height, borderRadius: radius };
  return <span className={`skeleton ${className}`.trim()} style={style} aria-hidden="true" />;
}

/** Progress of work with a known or unknown end. */
export function Progress({ value, label }: { value?: number; label: string }) {
  const indeterminate = value === undefined;
  return <div
    className={`progress ${indeterminate ? "progress-indeterminate" : ""}`.trim()}
    role="progressbar"
    aria-label={label}
    aria-valuenow={indeterminate ? undefined : Math.round(value)}
    aria-valuemin={indeterminate ? undefined : 0}
    aria-valuemax={indeterminate ? undefined : 100}
  >
    <span style={indeterminate ? undefined : { width: `${Math.min(100, Math.max(0, value))}%` }} />
  </div>;
}
