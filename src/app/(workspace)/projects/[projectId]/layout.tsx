import type { ReactNode } from "react";

/**
 * Holds the workspace and a parallel slot for whichever project tool is open.
 *
 * Because the tool arrives in its own slot, opening Media or Brand or Export
 * does not replace the workspace — the preview session, the agent conversation
 * and the page you were editing all stay exactly as they were, and closing the
 * panel is a plain history back.
 */
export default function ProjectLayout({ children, panel }: { children: ReactNode; panel: ReactNode }) {
  return <>{children}{panel}</>;
}
