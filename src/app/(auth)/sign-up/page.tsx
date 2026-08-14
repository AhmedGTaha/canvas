import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/auth-form";
import { getCurrentUser } from "@/server/auth/session";
import { redirect } from "next/navigation";
import { safeReturnTo } from "@/domain/auth/return-to";

export const metadata: Metadata = { title: "Create account" };

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const returnTo = safeReturnTo((await searchParams).returnTo);
  if (await getCurrentUser()) redirect(returnTo);
  return <section className="auth-card"><div className="auth-heading"><h1>Create your account</h1><p>Then describe the website you want, and Canvas builds it.</p></div><AuthForm mode="sign-up" returnTo={returnTo === "/dashboard" ? undefined : returnTo} /></section>;
}
