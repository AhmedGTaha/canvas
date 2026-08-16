import Link from "next/link";
import type { ReactNode } from "react";
import { CanvasLogo } from "@/components/brand/canvas-logo";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <main className="auth-layout">
    <div className="auth-brand"><Link href="/"><CanvasLogo size="lg" /></Link></div>
    {children}
    <p className="auth-footer">Build a website by describing it.</p>
  </main>;
}
