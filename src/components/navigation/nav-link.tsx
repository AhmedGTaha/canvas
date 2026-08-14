"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** A destination in the top bar. Current is marked for assistive tech too. */
export function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
  return <Link className={`nav-link ${active ? "nav-link-active" : ""}`.trim()} href={href} aria-current={active ? "page" : undefined}>{label}</Link>;
}
