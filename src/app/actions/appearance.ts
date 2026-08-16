"use server";

import { cookies } from "next/headers";
import { APPEARANCE_COOKIE, APPEARANCE_COOKIE_MAX_AGE, parseAppearance } from "@/domain/appearance/model";

/**
 * Remembers how this browser should render Canvas.
 *
 * The cookie exists so the *server* can put the choice on <html> before the
 * markup is sent. That is the whole reason this is not localStorage: a value
 * only the client knows can only be applied after the first paint, which is the
 * flash of the wrong appearance this avoids.
 *
 * Nothing here touches the user record or any project data, so it needs no
 * authorization: the worst a caller can do to themselves is choose a colour.
 */
export async function setAppearanceAction(value: string) {
  const appearance = parseAppearance(value);
  (await cookies()).set(APPEARANCE_COOKIE, appearance, {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: APPEARANCE_COOKIE_MAX_AGE,
  });
  return appearance;
}
