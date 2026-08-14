"use client";

import Link from "next/link";
import { ChevronDown, Home, LayoutGrid, LogOut, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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
    {open ? <div className="menu-content account-menu" role="menu">
      <p className="account-identity"><strong>{userName}</strong>{email ? <span>{email}</span> : null}</p>
      <Link className="menu-item" role="menuitem" href="/dashboard" onClick={() => setOpen(false)}><Home size={15} />Your websites</Link>
      <Link className="menu-item" role="menuitem" href="/workspaces" onClick={() => setOpen(false)}><LayoutGrid size={15} />Workspaces</Link>
      <Link className="menu-item" role="menuitem" href="/account" onClick={() => setOpen(false)}><UserRound size={15} />Account</Link>
      <div className="menu-separator" role="separator" />
      <button type="button" role="menuitem" className="menu-item" onClick={() => { setOpen(false); onSignOut(); }}><LogOut size={15} />Sign out</button>
    </div> : null}
  </div>;
}

export function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}
