import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/auth-form";
import { getCurrentUser } from "@/server/auth/session";
import { redirect } from "next/navigation";
import { safeReturnTo } from "@/domain/auth/return-to";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const returnTo = safeReturnTo((await searchParams).returnTo);
  if (await getCurrentUser()) redirect(returnTo);
  return <section className="auth-card"><div className="auth-heading"><h1>Welcome back</h1><p>Sign in to keep building your websites.</p></div><AuthForm mode="sign-in" returnTo={returnTo === "/dashboard" ? undefined : returnTo} /></section>;
}
