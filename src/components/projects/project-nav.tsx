"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Files, LayoutDashboard, Palette, UsersRound } from "lucide-react";

export function ProjectNav({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const links = [
    { href: `/projects/${projectId}`, label: "Overview", icon: LayoutDashboard, exact: true },
    { href: `/projects/${projectId}/pages`, label: "Pages", icon: Files },
    { href: `/projects/${projectId}/brand`, label: "Brand / Theme", icon: Palette },
    { href: `/projects/${projectId}/collaborators`, label: "Collaborators", icon: UsersRound },
  ];
  return <nav className="project-nav" aria-label="Project navigation">{links.map(({ href, label, icon: Icon, exact }) => {
    const active = exact ? pathname === href : pathname.startsWith(href);
    return <Link key={href} href={href} className={active ? "project-nav-active" : ""} aria-current={active ? "page" : undefined}><Icon size={15} />{label}</Link>;
  })}</nav>;
}
