import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/auth-form";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return <section className="auth-card"><div className="auth-heading"><p className="eyebrow">Welcome back</p><h1>Sign in to Canvas</h1><p>Continue building your website projects.</p></div><AuthForm mode="sign-in" /></section>;
}
