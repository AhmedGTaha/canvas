import Link from "next/link";
import type { ReactNode } from "react";
import type { AuthenticatedUser } from "@/domain/auth/service";
import { signOutAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { SidebarNavItem } from "./sidebar-nav";

export function AppShell({ user, children }: { user: AuthenticatedUser; children: ReactNode }) {
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <aside className="sidebar">
      <Link href="/dashboard" className="brand"><span className="brand-mark">C</span><span>Canvas</span></Link>
      <nav aria-label="Main navigation" className="sidebar-nav">
        <SidebarNavItem href="/dashboard" label="Websites" icon="projects" />
        <SidebarNavItem href="/workspaces" label="Workspaces" icon="workspaces" />
      </nav>
      <div className="sidebar-footer"><SidebarNavItem href="/account" label="Account" icon="account" /></div>
    </aside>
    <div className="app-frame">
      <header className="topbar" aria-label="Account"><span className="topbar-name">{user.displayName}</span><form action={signOutAction}><Button type="submit" variant="ghost">Sign out</Button></form></header>
      <main className="main-content" id="main-content" tabIndex={-1}>{children}</main>
    </div>
  </div>;
}
