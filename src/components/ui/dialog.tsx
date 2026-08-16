"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button, type ButtonVariant } from "./button";
import { IconButton } from "./icon-button";

/**
 * A modal that asks for a decision or a few values.
 *
 * A native <dialog> gives focus trapping, Escape and a backdrop without
 * reimplementing any of them. Clicking the backdrop dismisses, because a dialog
 * that only closes through its own button traps anyone who opened it by
 * accident.
 */
export function Modal({ open, title, description, onClose, footer, size = "default", className = "", children }: {
  open: boolean; title: string; description?: string; onClose: () => void; footer?: ReactNode; size?: "default" | "wide"; className?: string; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    // An open modal removed from the DOM can leave the page inert, which makes
    // the whole app unclickable with nothing on screen to explain why.
    return () => { if (dialog.open) dialog.close(); };
  }, [open]);

  return <dialog
    className={`dialog ${size === "wide" ? "dialog-wide" : ""} ${className}`.trim()}
    ref={ref}
    aria-labelledby={headingId}
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === ref.current) onClose(); }}
  >
    <div className="dialog-panel">
      <div className="dialog-header">
        <div><h2 id={headingId}>{title}</h2>{description ? <p>{description}</p> : null}</div>
        <IconButton label="Close" icon={<X size={17} />} onClick={onClose} />
      </div>
      {children}
      {footer}
    </div>
  </dialog>;
}

/**
 * A modal that opens from its own trigger.
 *
 * Kept for the create/rename forms, where the trigger and the dialog are one
 * unit and nothing outside needs to know whether it is open.
 */
export function Dialog({ title, description, triggerLabel, triggerVariant = "primary", triggerIcon, children }: {
  title: string; description?: string; triggerLabel: string; triggerVariant?: ButtonVariant; triggerIcon?: ReactNode; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  return <>
    <Button variant={triggerVariant} icon={triggerIcon} onClick={() => ref.current?.showModal()}>{triggerLabel}</Button>
    <dialog className="dialog" ref={ref} aria-labelledby={headingId} onClick={(event) => { if (event.target === ref.current) ref.current?.close(); }}>
      <div className="dialog-panel">
        <div className="dialog-header">
          <div><h2 id={headingId}>{title}</h2>{description ? <p>{description}</p> : null}</div>
          <IconButton label="Close" icon={<X size={17} />} onClick={() => ref.current?.close()} />
        </div>
        {children}
      </div>
    </dialog>
  </>;
}
