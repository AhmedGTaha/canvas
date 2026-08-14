import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The heading of a screen outside the workspace.
 *
 * `back` is a real link rather than a history step, so it works on a page that
 * was opened directly. There is deliberately no eyebrow: a label above a title
 * that repeats the title is noise, and the nav already says where you are.
 */
export function PageHeader({ title, description, actions, back }: {
  title: string; description?: string; actions?: ReactNode; back?: { href: string; label: string };
}) {
  return <header className="page-header">
    <div className="page-header-main">
      {back ? <Link className="back-link" href={back.href}><ChevronLeft size={14} aria-hidden="true" />{back.label}</Link> : null}
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
    </div>
    {actions ? <div className="page-header-actions">{actions}</div> : null}
  </header>;
}
