"use server";

import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { authenticate, register } from "@/domain/auth/service";
import { userMessage } from "@/domain/shared/errors";
import { clearSession, setSession } from "@/server/auth/session";

export type AuthActionState = { error?: string; fieldErrors?: Record<string, string[]> };

function fields(formData: FormData) {
  return {
    displayName: formData.get("displayName"),
    email: formData.get("email"),
    password: formData.get("password"),
  };
}

export async function signUpAction(_state: AuthActionState, formData: FormData): Promise<AuthActionState> {
  try {
    const user = await register(fields(formData));
    await setSession(user.id);
  } catch (error: unknown) {
    if (error instanceof ZodError) return { fieldErrors: error.flatten().fieldErrors as Record<string, string[]> };
    return { error: userMessage(error, "Account could not be created.") };
  }
  redirect("/dashboard");
}

export async function signInAction(_state: AuthActionState, formData: FormData): Promise<AuthActionState> {
  try {
    const user = await authenticate(fields(formData));
    await setSession(user.id);
  } catch (error: unknown) {
    if (error instanceof ZodError) return { fieldErrors: error.flatten().fieldErrors as Record<string, string[]> };
    return { error: userMessage(error, "Sign in failed.") };
  }
  redirect("/dashboard");
}

export async function signOutAction() {
  await clearSession();
  redirect("/sign-in");
}
