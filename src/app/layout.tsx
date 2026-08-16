import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { APPEARANCE_COOKIE, appearanceAttribute, parseAppearance } from "@/domain/appearance/model";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Canvas", template: "%s · Canvas" },
  description: "Build polished websites with an AI-assisted workspace.",
};

/**
 * The appearance is decided here, on the server, before any markup is sent.
 *
 * That is what makes the switch flash-free without a blocking script in <head>:
 * an explicit choice arrives as an attribute on <html>, and "system" — the
 * default — arrives as no attribute at all, which base.css already resolves from
 * the device with `color-scheme: light dark`.
 */
export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const appearance = parseAppearance((await cookies()).get(APPEARANCE_COOKIE)?.value);
  return <html lang="en" data-appearance={appearanceAttribute(appearance)}><body>{children}</body></html>;
}
