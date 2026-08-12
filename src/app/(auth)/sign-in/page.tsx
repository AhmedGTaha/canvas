import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/auth-form";
import { getCurrentUser } from "@/server/auth/session";
import { redirect } from "next/navigation";
import { safeReturnTo } from "@/domain/auth/return-to";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const returnTo = safeReturnTo((await searchParams).returnTo);
  if (await getCurrentUser()) redirect(returnTo);
  return <section className="auth-card"><div className="auth-heading"><p className="eyebrow">Welcome back</p><h1>Sign in to Canvas</h1><p>Continue building your website projects.</p></div><AuthForm mode="sign-in" returnTo={returnTo === "/dashboard" ? undefined : returnTo} /></section>;
}
