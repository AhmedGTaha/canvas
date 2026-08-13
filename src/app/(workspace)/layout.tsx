import type { ReactNode } from "react";
import { requireAuthenticatedUser } from "@/server/auth/session";

/**
 * The workspace runs outside the dashboard shell: no sidebar, no top bar, no
 * page gutter. It owns the whole viewport, and its own menu bar carries the
 * navigation the sidebar used to provide.
 */
export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  await requireAuthenticatedUser();
  return children;
}
