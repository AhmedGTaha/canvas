import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSession, readSession, revokeSession } from "@/domain/auth/service";

const cookieName = process.env.NODE_ENV === "production" ? "__Host-canvas-session" : "canvas_session";

export async function setSession(userId: string) {
  const { token, expiresAt } = await createSession(userId);
  const cookieStore = await cookies();
  cookieStore.set(cookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function getCurrentUser() {
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;
  return readSession(token);
}

export async function requireAuthenticatedUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return user;
}

export async function clearSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(cookieName)?.value;
  if (token) await revokeSession(token);
  cookieStore.delete(cookieName);
}
