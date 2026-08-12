import { MoreHorizontal } from "lucide-react";
import type { ReactNode } from "react";

export function Menu({ label = "Open menu", children }: { label?: string; children: ReactNode }) {
  return <details className="menu">
    <summary aria-label={label}><MoreHorizontal size={18} /></summary>
    <div className="menu-content">{children}</div>
  </details>;
}
