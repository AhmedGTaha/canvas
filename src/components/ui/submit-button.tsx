"use client";

import { LoaderCircle } from "lucide-react";
import { useFormStatus } from "react-dom";
import { Button } from "./button";
import type { ButtonVariant } from "./button";

export function SubmitButton({ children, pendingLabel = "Saving…", variant }: { children: React.ReactNode; pendingLabel?: string; variant?: ButtonVariant }) {
  const { pending } = useFormStatus();
  return <Button type="submit" variant={variant} disabled={pending} data-pending={pending || undefined}>{pending ? <><LoaderCircle className="spin" size={15} />{pendingLabel}</> : children}</Button>;
}
