"use client";

import Link from "next/link";
import { useTransition, type ReactNode } from "react";
import { signOutAction } from "@/app/actions/auth";
import { AccountMenu } from "./account-menu";
import { NavLink } from "./nav-link";

/**
 * The shell around everything outside a project: websites, workspaces, account.
 *
 * Navigation lives in the top bar rather than a fixed 208px rail. Three
 * destinations never justified a permanent column, and reclaiming it gives the
 * content the full width it needs at laptop sizes.
 */
export function AppShell({ user, children }: { user: { displayName: string; email: string }; children: ReactNode }) {
  const [, startTransition] = useTransition();
  return <div className="app">
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <header className="app-bar">
      <Link href="/dashboard" className="app-brand"><span className="brand-mark" aria-hidden="true">C</span>Canvas</Link>
      <nav className="app-nav" aria-label="Main">
        <NavLink href="/dashboard" label="Websites" />
        <NavLink href="/workspaces" label="Workspaces" />
      </nav>
      <div className="app-bar-end">
        <AccountMenu userName={user.displayName} email={user.email} onSignOut={() => startTransition(() => { void signOutAction(); })} />
      </div>
    </header>
    <main className="app-main" id="main-content" tabIndex={-1}>{children}</main>
  </div>;
}
