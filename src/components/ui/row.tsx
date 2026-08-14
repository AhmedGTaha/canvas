import type { ReactNode } from "react";

/**
 * The one list row in Canvas.
 *
 * Pages, images, sections, versions, tasks and collaborators are all a leading
 * glyph, a name that truncates, optional supporting text, trailing metadata and
 * actions. Selected rows carry the product's selection spine — the same 2px
 * mark used in the explorer and the activity bar — so "this is the thing I am
 * working on" looks identical wherever it appears.
 *
 * Actions fade in on hover but are always in the tab order, because hiding a
 * control from the keyboard is hiding it.
 */
export function Row({ icon, title, description, meta, actions, selected = false, onClick, as, href, id }: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  as?: "button" | "div";
  href?: string;
  id?: string;
}) {
  const body = <>
    {icon ? <span className="row-icon">{icon}</span> : null}
    <span className="row-main"><strong>{title}</strong>{description ? <small>{description}</small> : null}</span>
    {meta ? <span className="row-meta">{meta}</span> : null}
  </>;
  const className = `row ${selected ? "row-selected" : ""}`.trim();

  // Actions inside a row cannot be nested in the row's own button, so a row
  // with actions is a container with a button inside it rather than a button.
  if (actions) {
    return <div className={className} id={id}>
      {onClick ? <button type="button" className="row-button" aria-current={selected ? "true" : undefined} onClick={onClick}>{body}</button>
        : href ? <a className="row-button" href={href}>{body}</a> : <span className="row-button">{body}</span>}
      <span className="row-actions">{actions}</span>
    </div>;
  }
  if (href) return <a className={className} id={id} href={href}>{body}</a>;
  if (onClick || as === "button") return <button type="button" className={`${className} row-button`} id={id} aria-current={selected ? "true" : undefined} onClick={onClick}>{body}</button>;
  return <div className={className} id={id}>{body}</div>;
}

export function List({ label, children }: { label?: string; children: ReactNode }) {
  return <ul className="list" aria-label={label}>{children}</ul>;
}
