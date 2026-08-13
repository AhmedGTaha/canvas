import Link from "next/link";
import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <main className="auth-layout">
    <div className="auth-brand"><Link href="/"><span className="auth-brand-mark" aria-hidden="true">C</span>Canvas</Link></div>
    {children}
    <p className="auth-footer">Build a website by describing it.</p>
  </main>;
}
