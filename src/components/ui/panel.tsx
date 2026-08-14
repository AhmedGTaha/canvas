import type { ReactNode } from "react";

/**
 * Panel anatomy.
 *
 * Every tool in Canvas — the ones in overlays and the ones in the sidebar —
 * is built from these four parts in this order: header (what this is), an
 * optional toolbar (what you can do to the whole of it), body (the work), and
 * an optional footer (state, or the action that ends the task). Nine tools that
 * each invent their own heading and action placement read as nine products;
 * this is what makes them read as one.
 */
export function Panel({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`panel ${className}`.trim()}>{children}</div>;
}

export function PanelHeader({ title, description, actions, headingId, level = "h2" }: {
  title: ReactNode; description?: ReactNode; actions?: ReactNode; headingId?: string; level?: "h1" | "h2";
}) {
  const Heading = level;
  return <header className="panel-header">
    <div className="panel-header-main">
      <Heading id={headingId}>{title}</Heading>
      {description ? <p>{description}</p> : null}
    </div>
    {actions ? <div className="panel-header-actions">{actions}</div> : null}
  </header>;
}

/** Filters, search and view controls for the whole panel body. */
export function PanelToolbar({ children }: { children: ReactNode }) {
  return <div className="panel-toolbar">{children}</div>;
}

/** The scroll container. Everything above and below it stays put. */
export function PanelBody({ flush = false, className = "", children }: { flush?: boolean; className?: string; children: ReactNode }) {
  return <div className={`panel-body ${flush ? "panel-body-flush" : ""} ${className}`.trim()}>{children}</div>;
}

export function PanelFooter({ children }: { children: ReactNode }) {
  return <footer className="panel-footer">{children}</footer>;
}

/**
 * A titled block inside a body. Sections are separated by a rule and space,
 * not by giving every group its own card.
 */
export function Section({ title, description, actions, children, headingLevel = "h2" }: {
  title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; headingLevel?: "h2" | "h3";
}) {
  const Heading = headingLevel;
  return <section className="section">
    {title ? <div className="section-head">
      <div><Heading>{title}</Heading>{description ? <p>{description}</p> : null}</div>
      {actions ? <div className="section-head-actions">{actions}</div> : null}
    </div> : null}
    {children}
  </section>;
}
