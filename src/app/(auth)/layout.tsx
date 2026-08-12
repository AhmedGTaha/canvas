import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getCurrentUser } from "@/server/auth/session";

export default async function AuthLayout({ children }: { children: ReactNode }) {
  if (await getCurrentUser()) redirect("/dashboard");
  return <main className="auth-layout"><div className="auth-brand"><Link href="/">Canvas</Link></div>{children}<p className="auth-footer">A calm place to build your next website.</p></main>;
}
