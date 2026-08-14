"use client";

import { useId, useRef, type ReactNode } from "react";
import { Button } from "./button";

/**
 * The confirmation before something irreversible.
 *
 * The description says what will happen and what cannot be undone; the
 * confirming control repeats the verb from the trigger rather than saying "OK",
 * so nobody confirms an action they have stopped reading about.
 */
export function ConfirmationDialog({ title, triggerLabel = title, description, action }: {
  title: string; triggerLabel?: string; description: string; action: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const bodyId = useId();
  return <>
    <Button variant="danger" size="sm" onClick={() => ref.current?.showModal()}>{triggerLabel}</Button>
    <dialog
      className="dialog"
      ref={ref}
      aria-labelledby={headingId}
      aria-describedby={bodyId}
      onClick={(event) => { if (event.target === ref.current) ref.current?.close(); }}
    >
      <div className="dialog-panel">
        <h2 id={headingId}>{title}</h2>
        <p id={bodyId}>{description}</p>
        <div className="form-actions">
          <Button variant="secondary" onClick={() => ref.current?.close()}>Cancel</Button>
          {action}
        </div>
      </div>
    </dialog>
  </>;
}
