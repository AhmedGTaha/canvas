import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/auth-form";

export const metadata: Metadata = { title: "Create account" };

export default function SignUpPage() {
  return <section className="auth-card"><div className="auth-heading"><p className="eyebrow">Get started</p><h1>Create your account</h1><p>Set up your workspace and start your first project.</p></div><AuthForm mode="sign-up" /></section>;
}
