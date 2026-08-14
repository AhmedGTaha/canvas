"use server";

import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { authenticate, register } from "@/domain/auth/service";
import { userMessage } from "@/domain/shared/errors";
import { clearSession, setSession } from "@/server/auth/session";
import { safeReturnTo } from "@/domain/auth/return-to";

/**
 * What the form shows after a failed attempt.
 *
 * `values` exists because React resets an uncontrolled form once its action
 * settles: without echoing what was typed, a mistyped password also wiped the
 * email, and the person had to fill the whole form again to fix one field.
 * Passwords are never echoed.
 */
export type AuthActionState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  values?: { displayName?: string; email?: string };
};

function fields(formData: FormData) {
  return {
    displayName: formData.get("displayName"),
    email: formData.get("email"),
    password: formData.get("password"),
    returnTo: formData.get("returnTo"),
  };
}

function submitted(formData: FormData) {
  const displayName = formData.get("displayName");
  const email = formData.get("email");
  return { displayName: typeof displayName === "string" ? displayName : undefined, email: typeof email === "string" ? email : undefined };
}

export async function signUpAction(_state: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const returnTo = safeReturnTo(formData.get("returnTo"));
  const values = submitted(formData);
  try {
    const user = await register(fields(formData));
    await setSession(user.id);
  } catch (error: unknown) {
    if (error instanceof ZodError) return { fieldErrors: error.flatten().fieldErrors as Record<string, string[]>, values };
    return { error: userMessage(error, "Your account could not be created. Try again in a moment."), values };
  }
  redirect(returnTo);
}

export async function signInAction(_state: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const returnTo = safeReturnTo(formData.get("returnTo"));
  const values = submitted(formData);
  try {
    const user = await authenticate(fields(formData));
    await setSession(user.id);
  } catch (error: unknown) {
    if (error instanceof ZodError) return { fieldErrors: error.flatten().fieldErrors as Record<string, string[]>, values };
    return { error: userMessage(error, "Sign in failed."), values };
  }
  redirect(returnTo);
}

export async function signOutAction() {
  await clearSession();
  redirect("/sign-in");
}
