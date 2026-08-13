"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { notePanelPushed, panelHref } from "./panel-url";

/**
 * A cross-reference from inside one project tool to another.
 *
 * It swaps the open tool on the current URL rather than navigating anywhere,
 * so the workspace underneath — preview session, conversation, current page —
 * is untouched. Replacing rather than pushing keeps the back stack one entry
 * deep however many tools the user hops between.
 */
export function PanelLink({ tool, node, className, children }: { tool: string; node?: string; className?: string; children: ReactNode }) {
  const router = useRouter();
  return <button
    type="button"
    className={className}
    onClick={() => {
      const href = panelHref(new URL(window.location.href), tool, node ? { node } : {});
      if (new URL(window.location.href).searchParams.has("tool")) router.replace(href, { scroll: false });
      else { notePanelPushed(); router.push(href, { scroll: false }); }
    }}
  >{children}</button>;
}
