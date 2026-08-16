"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useSyncExternalStore, useTransition } from "react";
import { setAppearanceAction } from "@/app/actions/appearance";
import { SegmentedControl } from "@/components/ui/segmented";
import { APPEARANCE_COOKIE, DEFAULT_APPEARANCE, appearanceAttribute, parseAppearance, type Appearance } from "@/domain/appearance/model";

const OPTIONS = [
  { value: "system", label: "System", icon: <Monitor size={13} aria-hidden="true" /> },
  { value: "light", label: "Light", icon: <Sun size={13} aria-hidden="true" /> },
  { value: "dark", label: "Dark", icon: <Moon size={13} aria-hidden="true" /> },
] as const satisfies ReadonlyArray<{ value: Appearance; label: string; icon: ReactNode }>;

/**
 * How Canvas looks. The only control that writes the appearance.
 *
 * The switch happens in the DOM first and is persisted second. Waiting for the
 * server before the screen changes would put a round trip between a click and
 * its result, on the one control whose entire job is immediate — so the
 * attribute is written straight away and the cookie catches up in a transition.
 * The cookie is what makes the *next* page load correct; the attribute is what
 * makes *this* click correct.
 *
 * The current value is held in a tiny store beside the DOM rather than in each
 * copy of the component, because there are two on screen at once — the account
 * menu and the account screen — and a preference that disagreed with itself in
 * two places would be worse than no control at all.
 */
export function AppearanceControl({ label = "Appearance" }: { label?: string }) {
  const appearance = useSyncExternalStore(subscribe, readAppearance, serverAppearance);
  const [, startTransition] = useTransition();

  const choose = useCallback((next: Appearance) => {
    writeAppearance(next);
    startTransition(() => { void setAppearanceAction(next); });
  }, []);

  return <SegmentedControl label={label} value={appearance} options={[...OPTIONS]} onChange={choose} />;
}

/* ------------------------------------------------------------------- store */

let current: Appearance | null = null;
const listeners = new Set<() => void>();

function readAppearance(): Appearance {
  return current ??= readAppearanceCookie();
}

/**
 * The server has no cookie-derived markup for this control to match, so it
 * renders the default and `useSyncExternalStore` re-reads on the client. That
 * is the hook's purpose: an external value that only exists after hydration,
 * without a mismatch and without a setState in an effect.
 */
function serverAppearance(): Appearance {
  return DEFAULT_APPEARANCE;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function writeAppearance(next: Appearance) {
  current = next;
  applyAppearance(next);
  for (const listener of listeners) listener();
}

function readAppearanceCookie(): Appearance {
  if (typeof document === "undefined") return DEFAULT_APPEARANCE;
  const match = document.cookie.split("; ").find((entry) => entry.startsWith(`${APPEARANCE_COOKIE}=`));
  return parseAppearance(match?.slice(APPEARANCE_COOKIE.length + 1));
}

/**
 * Writes the appearance onto <html>, easing the change rather than cutting it.
 *
 * A whole screen changing brightness in one frame reads as a flash, so the root
 * carries `data-appearance-changing` for the length of the cross-fade and
 * base.css arms a colour transition only while it is there — never during normal
 * work, where a colour that lags a click is the latency this product avoids.
 * Under `prefers-reduced-motion` the stylesheet skips the fade entirely, and the
 * attribute is still cleaned up on the same timer.
 */
function applyAppearance(appearance: Appearance) {
  const root = document.documentElement;
  const attribute = appearanceAttribute(appearance);

  root.setAttribute("data-appearance-changing", "");
  if (attribute) root.setAttribute("data-appearance", attribute);
  else root.removeAttribute("data-appearance");

  window.clearTimeout(pendingCleanup);
  pendingCleanup = window.setTimeout(() => root.removeAttribute("data-appearance-changing"), 260);
}

let pendingCleanup: number | undefined;
