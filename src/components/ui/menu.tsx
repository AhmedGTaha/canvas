"use client";

import { MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

/**
 * Contextual `…` menu.
 *
 * Dismisses on outside pointerdown, on Escape, and returns focus to the
 * trigger, so keyboard users are never stranded inside it. The trigger keeps
 * its own name — "Open menu" tells nobody which row they are acting on, so
 * callers pass what it acts upon.
 */
export function Menu({ label = "Open menu", align = "end", trigger, children }: {
  label?: string; align?: "start" | "end"; trigger?: ReactNode; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("pointerdown", onPointerDown); document.removeEventListener("keydown", onKeyDown); };
  }, [open]);

  return <div className="menu" ref={root}>
    <button type="button" ref={triggerRef} className="menu-trigger" aria-label={label} title={label} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((value) => !value)}>
      {trigger ?? <MoreHorizontal size={16} />}
    </button>
    {open ? <div className="menu-content" role="menu" style={align === "start" ? { right: "auto", left: 0 } : undefined} onClick={() => setOpen(false)}>{children}</div> : null}
  </div>;
}

/** An action in a menu. Destructive ones say so in colour and in wording. */
export function MenuItem({ icon, shortcut, tone, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: ReactNode; shortcut?: string; tone?: "danger";
}) {
  return <button type="button" role="menuitem" className={`menu-item ${tone === "danger" ? "menu-item-danger" : ""}`.trim()} {...props}>
    {icon}
    <span className="truncate">{children}</span>
    {shortcut ? <span className="menu-item-key">{shortcut}</span> : null}
  </button>;
}

export function MenuSeparator() {
  return <div className="menu-separator" role="separator" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <p className="menu-label">{children}</p>;
}
