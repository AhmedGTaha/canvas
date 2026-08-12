import Link from "next/link";
import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <main className="auth-layout"><div className="auth-brand"><Link href="/">Canvas</Link></div>{children}<p className="auth-footer">A calm place to build your next website.</p></main>;
}
