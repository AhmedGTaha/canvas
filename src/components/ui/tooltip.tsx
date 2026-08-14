"use client";

import { cloneElement, useId, useRef, useState, type ReactElement, type ReactNode } from "react";

/**
 * A label for a control whose meaning is not fully carried by what you can see.
 *
 * It never holds an action or information available nowhere else, and it opens
 * on focus as well as hover so keyboard users get the same label. The delay is
 * what stops a toolbar from flickering as the pointer crosses it.
 */
export function Tooltip({ label, placement = "bottom", delay = 400, children }: {
  label: string; placement?: "top" | "bottom" | "right"; delay?: number; children: ReactElement<{ "aria-describedby"?: string }>;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number>(undefined);
  const id = useId();

  function show() { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setOpen(true), delay); }
  function hide() { window.clearTimeout(timer.current); setOpen(false); }

  return <span className="tooltip-host" onPointerEnter={show} onPointerLeave={hide} onFocus={() => setOpen(true)} onBlur={hide}>
    {cloneElement(children, { "aria-describedby": open ? id : undefined })}
    {open ? <span className={`tooltip tooltip-${placement}`} role="tooltip" id={id}>{label}</span> : null}
  </span>;
}

/** A keyboard shortcut, set in the product's own type rather than a mono face. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}
