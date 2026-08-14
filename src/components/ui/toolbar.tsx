import type { HTMLAttributes, ReactNode } from "react";

/**
 * A row of controls above or beside a body of work.
 *
 * Controls are grouped by what they act on, and groups are separated by a rule
 * rather than by guessing at gaps — so the same three clusters (navigate, view,
 * act) sit in the same place in every toolbar in the product.
 */
export function Toolbar({ label, className = "", children, ...props }: HTMLAttributes<HTMLDivElement> & { label: string; children: ReactNode }) {
  return <div className={`toolbar ${className}`.trim()} role="toolbar" aria-label={label} {...props}>{children}</div>;
}

export function ToolbarGroup({ label, className = "", children }: { label?: string; className?: string; children: ReactNode }) {
  return <div className={`toolbar-group ${className}`.trim()} role={label ? "group" : undefined} aria-label={label}>{children}</div>;
}

export function ToolbarDivider() {
  return <span className="toolbar-divider" aria-hidden="true" />;
}

export function ToolbarSpacer() {
  return <span className="toolbar-spacer" aria-hidden="true" />;
}
