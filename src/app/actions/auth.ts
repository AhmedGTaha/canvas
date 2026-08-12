"use server";

import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { authenticate, register } from "@/domain/auth/service";
import { userMessage } from "@/domain/shared/errors";
import { clearSession, setSession } from "@/server/auth/session";
import { safeReturnTo } from "@/domain/auth/return-to";

export type AuthActionState = { error?: string; fieldErrors?: Record<string, string[]> };

function fields(formData: FormData) {
  return {
    displayName: formData.get("displayName"),
    email: formData.get("email"),
    password: formData.get("password"),
    returnTo: formData.get("returnTo"),
  };
}

export async function signUpAction(_state: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const returnTo = safeReturnTo(formData.get("returnTo"));
  try {
    const user = await register(fields(formData));
    await setSession(user.id);
  } catch (error: unknown) {
    if (error instanceof ZodError) return { fieldErrors: error.flatten().fieldErrors as Record<string, string[]> };
    return { error: userMessage(error, "Account could not be created.") };
  }
  redirect(returnTo);
}

export async function signInAction(_state: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const returnTo = safeReturnTo(formData.get("returnTo"));
  try {
    const user = await authenticate(fields(formData));
    await setSession(user.id);
  } catch (error: unknown) {
    if (error instanceof ZodError) return { fieldErrors: error.flatten().fieldErrors as Record<string, string[]> };
    return { error: userMessage(error, "Sign in failed.") };
  }
  redirect(returnTo);
}

export async function signOutAction() {
  await clearSession();
  redirect("/sign-in");
}
