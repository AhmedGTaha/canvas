"use client";

import { useId, useRef, type ReactNode } from "react";
import { Button } from "./button";

export function ConfirmationDialog({ title, triggerLabel = title, description, action }: { title: string; triggerLabel?: string; description: string; action: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  return <><Button variant="danger" onClick={() => ref.current?.showModal()}>{triggerLabel}</Button><dialog className="dialog" ref={ref} aria-labelledby={headingId} onClick={(event) => { if (event.target === ref.current) ref.current?.close(); }}><div className="dialog-panel"><h2 id={headingId}>{title}</h2><p>{description}</p><div className="form-actions"><Button variant="secondary" onClick={() => ref.current?.close()}>Cancel</Button>{action}</div></div></dialog></>;
}
