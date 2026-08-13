"use client";

import { MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Contextual `…` menu.
 *
 * Replaces the previous `<details>` implementation, which stayed open after an
 * outside click, ignored Escape, and left several menus open at once. This one
 * dismisses on outside pointerdown, on Escape, and returns focus to the trigger
 * so keyboard users are not stranded.
 */
export function Menu({ label = "Open menu", align = "end", children }: { label?: string; align?: "start" | "end"; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("pointerdown", onPointerDown); document.removeEventListener("keydown", onKeyDown); };
  }, [open]);

  return <div className="menu" ref={root}>
    <button type="button" ref={trigger} className="menu-trigger" aria-label={label} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((value) => !value)}>
      <MoreHorizontal size={17} />
    </button>
    {open ? <div className="menu-content" role="menu" style={align === "start" ? { right: "auto", left: 0 } : undefined} onClick={() => setOpen(false)}>{children}</div> : null}
  </div>;
}
