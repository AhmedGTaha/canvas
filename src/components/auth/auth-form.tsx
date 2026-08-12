"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signInAction, signUpAction, type AuthActionState } from "@/app/actions/auth";
import { Input } from "@/components/ui/form-controls";
import { SubmitButton } from "@/components/ui/submit-button";

const initialState: AuthActionState = {};

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const action = mode === "sign-up" ? signUpAction : signInAction;
  const [state, formAction] = useActionState(action, initialState);
  const signingUp = mode === "sign-up";

  return <form action={formAction} className="stack">
    {signingUp ? <Input name="displayName" label="Name" autoComplete="name" required maxLength={120} error={state.fieldErrors?.displayName?.[0]} /> : null}
    <Input name="email" label="Email" type="email" autoComplete="email" required maxLength={254} error={state.fieldErrors?.email?.[0]} />
    <Input name="password" label="Password" type="password" autoComplete={signingUp ? "new-password" : "current-password"} required minLength={signingUp ? 12 : undefined} maxLength={128} hint={signingUp ? "Use at least 12 characters." : undefined} error={state.fieldErrors?.password?.[0]} />
    {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
    <SubmitButton pendingLabel={signingUp ? "Creating account…" : "Signing in…"}>{signingUp ? "Create account" : "Sign in"}</SubmitButton>
    <p className="auth-switch">{signingUp ? "Already have an account?" : "New to Canvas?"} <Link href={signingUp ? "/sign-in" : "/sign-up"}>{signingUp ? "Sign in" : "Create an account"}</Link></p>
  </form>;
}
