"use client";

import Link from "next/link";
import { useActionState, useEffect, useId, useMemo, useState } from "react";
import { signInAction, signUpAction, type AuthActionState } from "@/app/actions/auth";
import { Input } from "@/components/ui/form-controls";
import { SubmitButton } from "@/components/ui/submit-button";

const initialState: AuthActionState = {};
const MIN_PASSWORD = 12;

/**
 * Sign in and sign up.
 *
 * The browser's own constraint bubble used to be the only thing standing
 * between a short password and the server: it appeared over the field, said
 * nothing a screen reader could keep, and vanished on the next keystroke, so
 * the form looked like it had simply ignored the click. Validation is checked
 * here instead and reported the same way the server reports it — a message tied
 * to the field, announced, with focus moved to the field that needs fixing.
 */
export function AuthForm({ mode, returnTo }: { mode: "sign-in" | "sign-up"; returnTo?: string }) {
  const action = mode === "sign-up" ? signUpAction : signInAction;
  const [state, formAction] = useActionState(action, initialState);
  const signingUp = mode === "sign-up";
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const displayNameId = useId();
  const emailId = useId();
  const passwordId = useId();
  // useId is stable for the life of the component, so these can be read from
  // an effect and from a submit handler without a ref.
  const ids = useMemo(() => ({ displayName: displayNameId, email: emailId, password: passwordId }), [displayNameId, emailId, passwordId]);

  const errors: Record<string, string | undefined> = {
    displayName: clientErrors.displayName ?? state.fieldErrors?.displayName?.[0],
    email: clientErrors.email ?? state.fieldErrors?.email?.[0],
    password: clientErrors.password ?? state.fieldErrors?.password?.[0],
  };

  // Focus follows the first thing that needs attention — but only when an
  // attempt has just been made, never while the person is still typing.
  useEffect(() => {
    const field = (["displayName", "email", "password"] as const).find((name) => state.fieldErrors?.[name]?.length);
    if (field) document.getElementById(ids[field])?.focus();
  }, [ids, state]);

  function check(event: React.FormEvent<HTMLFormElement>) {
    if (!signingUp) { setClientErrors({}); return; }
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    const name = String(data.get("displayName") ?? "").trim();
    const next: Record<string, string> = {};
    if (!name) next.displayName = "Enter your name.";
    if (password.length < MIN_PASSWORD) next.password = `Use at least ${MIN_PASSWORD} characters. That password has ${password.length}.`;
    setClientErrors(next);
    const first = (["displayName", "email", "password"] as const).find((field) => next[field]);
    if (first) { event.preventDefault(); document.getElementById(ids[first])?.focus(); }
  }

  return <form action={formAction} className="stack" noValidate onSubmit={check}>
    {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
    {signingUp ? <Input id={displayNameId} name="displayName" label="Name" autoComplete="name" required maxLength={120} defaultValue={state.values?.displayName} error={errors.displayName} /> : null}
    <Input id={emailId} name="email" label="Email" type="email" autoComplete="email" required maxLength={254} defaultValue={state.values?.email} error={errors.email} />
    <Input id={passwordId} name="password" label="Password" type="password" autoComplete={signingUp ? "new-password" : "current-password"} required minLength={signingUp ? MIN_PASSWORD : undefined} maxLength={128} hint={signingUp ? `Use at least ${MIN_PASSWORD} characters.` : undefined} error={errors.password} />
    {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
    <SubmitButton pendingLabel={signingUp ? "Creating account…" : "Signing in…"}>{signingUp ? "Create account" : "Sign in"}</SubmitButton>
    <p className="auth-switch">{signingUp ? "Already have an account?" : "New to Canvas?"} <Link href={{ pathname: signingUp ? "/sign-in" : "/sign-up", query: returnTo ? { returnTo } : undefined }}>{signingUp ? "Sign in" : "Create an account"}</Link></p>
  </form>;
}
