"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FolderKanban, LayoutGrid, UserRound } from "lucide-react";

const icons = { projects: LayoutGrid, workspaces: FolderKanban, account: UserRound };

export function SidebarNavItem({ href, label, icon }: { href: string; label: string; icon: keyof typeof icons }) {
  const Icon = icons[icon];
  const pathname = usePathname();
  const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
  return <Link className={`nav-item ${active ? "nav-item-active" : ""}`} href={href} aria-current={active ? "page" : undefined}><Icon size={18} /><span>{label}</span></Link>;
}
