import Link from "next/link";
import { FolderKanban, LayoutGrid, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import type { AuthenticatedUser } from "@/domain/auth/service";
import { signOutAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { SidebarNavItem } from "./sidebar-nav";

export function AppShell({ user, children }: { user: AuthenticatedUser; children: ReactNode }) {
  return <div className="app-shell">
    <aside className="sidebar">
      <Link href="/dashboard" className="brand"><span className="brand-mark">C</span><span>Canvas</span></Link>
      <nav aria-label="Main navigation" className="sidebar-nav">
        <SidebarNavItem href="/dashboard" label="Projects" icon={LayoutGrid} />
        <SidebarNavItem href="/workspaces" label="Workspaces" icon={FolderKanban} />
      </nav>
      <div className="sidebar-footer"><SidebarNavItem href="/account" label="Account" icon={UserRound} /></div>
    </aside>
    <div className="app-frame">
      <header className="topbar"><span className="topbar-name">{user.displayName}</span><form action={signOutAction}><Button type="submit" variant="ghost">Sign out</Button></form></header>
      <main className="main-content">{children}</main>
    </div>
  </div>;
}
