import type { ButtonHTMLAttributes } from "react";

export function buttonClass(variant: "primary" | "secondary" | "ghost" | "danger" = "primary") {
  return `button button-${variant}`;
}

export function Button({ className = "", variant = "primary", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  return <button className={`${buttonClass(variant)} ${className}`} {...props} />;
}
