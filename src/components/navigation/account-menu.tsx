"use client";

import Link from "next/link";
import { ChevronDown, Home, LayoutGrid, LogOut, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AppearanceControl } from "@/components/appearance/appearance-control";

/**
 * The account control, shared by the dashboard bar and the workspace title bar.
 *
 * There was one of these in each place, with different markup, different
 * dismissal behaviour and different destinations. One component means signing
 * out works the same way wherever you are.
 */
export function AccountMenu({ userName, email, onSignOut }: { userName: string; email?: string; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) { if (!root.current?.contains(event.target as Node)) setOpen(false); }
    function onKeyDown(event: KeyboardEvent) { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("pointerdown", onPointerDown); document.removeEventListener("keydown", onKeyDown); };
  }, [open]);

  return <div className="account" ref={root}>
    <button type="button" ref={trigger} className="account-trigger" aria-label={`Account menu for ${userName}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <span className="avatar" aria-hidden="true">{initials(userName)}</span>
      <ChevronDown size={12} aria-hidden="true" />
    </button>
    {/* The popover is the container; `menu` is the list of destinations inside
        it. The identity block and the appearance switch are neither menu items
        nor separators, and claiming they were made the whole popover an
        ill-formed menu for a screen reader. */}
    {open ? <div className="menu-content account-menu">
      <p className="account-identity"><strong>{userName}</strong>{email ? <span>{email}</span> : null}</p>
      <div role="menu" aria-label="Account">
        <Link className="menu-item" role="menuitem" href="/dashboard" onClick={() => setOpen(false)}><Home size={15} />Your websites</Link>
        <Link className="menu-item" role="menuitem" href="/workspaces" onClick={() => setOpen(false)}><LayoutGrid size={15} />Workspaces</Link>
        <Link className="menu-item" role="menuitem" href="/account" onClick={() => setOpen(false)}><UserRound size={15} />Account</Link>
        <div className="menu-separator" role="separator" />
        <button type="button" role="menuitem" className="menu-item" onClick={() => { setOpen(false); onSignOut(); }}><LogOut size={15} />Sign out</button>
      </div>
      {/* Appearance sits with the account rather than inside a project, because
          it is how this person wants Canvas to look everywhere — the same
          control is on the account screen, and the workspace title bar reaches
          it here without leaving the website being edited. */}
      <div className="menu-separator" role="separator" />
      <div className="account-appearance">
        <span className="menu-label">Appearance</span>
        <AppearanceControl label="Appearance" />
      </div>
    </div> : null}
  </div>;
}

export function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}
