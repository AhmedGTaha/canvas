import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * A control whose whole label is its icon.
 *
 * `label` is required and becomes both the accessible name and the native
 * tooltip, so an icon-only control can never ship without a name.
 */
export function IconButton({
  label, icon, size = "md", className = "", ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  label: string;
  icon: ReactNode;
  size?: "sm" | "md";
}) {
  const classes = ["icon-button", size === "sm" && "icon-button-sm", className].filter(Boolean).join(" ");
  return <button type="button" className={classes} aria-label={label} title={label} {...props}>{icon}</button>;
}
