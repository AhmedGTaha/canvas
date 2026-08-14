import { LoaderCircle } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", block = false) {
  return ["button", `button-${variant}`, size !== "md" && `button-${size}`, block && "button-block"].filter(Boolean).join(" ");
}

/**
 * The product's one button.
 *
 * `loading` keeps the button's own colour and swaps its glyph for a spinner —
 * a request in flight is a wait, not a refusal, and greying it out reads as
 * "unavailable". Use `disabled` only when the action genuinely cannot be taken.
 */
export function Button({
  className = "", variant = "primary", size = "md", block = false, loading = false, icon, children, disabled, ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; block?: boolean; loading?: boolean; icon?: ReactNode }) {
  return <button
    className={`${buttonClass(variant, size, block)} ${className}`.trim()}
    disabled={disabled ?? loading}
    data-pending={loading || undefined}
    {...props}
  >
    {loading ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : icon}
    {children}
  </button>;
}
