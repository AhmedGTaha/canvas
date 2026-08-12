"use client";

import { useRef, type ReactNode } from "react";
import { Button } from "./button";

export function ConfirmationDialog({ title, triggerLabel = title, description, action }: { title: string; triggerLabel?: string; description: string; action: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  return <><Button variant="danger" onClick={() => ref.current?.showModal()}>{triggerLabel}</Button><dialog className="dialog" ref={ref}><div className="dialog-panel"><h2>{title}</h2><p>{description}</p><div className="form-actions"><Button variant="secondary" onClick={() => ref.current?.close()}>Cancel</Button>{action}</div></div></dialog></>;
}
