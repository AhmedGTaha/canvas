"use client";

import { X } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { Button } from "./button";

export function Dialog({ title, description, triggerLabel, children }: { title: string; description?: string; triggerLabel: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  return <>
    <Button onClick={() => ref.current?.showModal()}>{triggerLabel}</Button>
    <dialog className="dialog" ref={ref} onClick={(event) => { if (event.target === ref.current) ref.current?.close(); }}>
      <div className="dialog-panel">
        <div className="dialog-header">
          <div><h2>{title}</h2>{description ? <p>{description}</p> : null}</div>
          <Button variant="ghost" aria-label="Close dialog" onClick={() => ref.current?.close()}><X size={18} /></Button>
        </div>
        {children}
      </div>
    </dialog>
  </>;
}
