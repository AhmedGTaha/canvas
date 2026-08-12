"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";

export function SidebarNavItem({ href, label, icon: Icon }: { href: string; label: string; icon: LucideIcon }) {
  const pathname = usePathname();
  const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
  return <Link className={`nav-item ${active ? "nav-item-active" : ""}`} href={href} aria-current={active ? "page" : undefined}><Icon size={18} /><span>{label}</span></Link>;
}
