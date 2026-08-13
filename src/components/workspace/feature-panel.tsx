"use client";

import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { closedPanelHref, takePanelPushed } from "./panel-url";

/**
 * Host for a project tool opened from the menu bar.
 *
 * Media, Building Blocks, Brand, Collaborators, Export, Settings and page
 * management all render in here, over the workspace, instead of navigating to
 * their own dashboard screen. Closing returns to exactly the page you were
 * editing, because the workspace was never unmounted.
 *
 * A native <dialog> gives focus trapping, Escape-to-close and a backdrop
 * without reimplementing any of them.
 */
export function FeaturePanel({ title, description, size = "wide", actions, children }: { title: string; description?: string; size?: "wide" | "drawer"; actions?: ReactNode; children: ReactNode }) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog?.isConnected) return;
    if (!dialog.open) {
      dialog.showModal();
      // showModal() otherwise puts focus on the first focusable descendant,
      // which in every panel is the close button — so the first thing a screen
      // reader announces on opening a tool is how to leave it. Focusing the
      // dialog announces its heading instead, and Tab still walks the panel
      // from the top.
      dialog.focus();
    }
    // A modal <dialog> that is removed from the DOM while still open is not
    // guaranteed to release the page from its inert state, which leaves the
    // whole workspace unclickable. Any unmount that is not a close() — a link
    // inside the panel navigating, for instance — has to close it explicitly.
    return () => { if (dialog.open) dialog.close(); };
  }, []);

  // Escape and backdrop dismissal both mean "go back to the workspace", which
  // is this same URL without the tool parameters. Stepping back is preferred
  // when the workspace put the open tool in history, so the browser's own back
  // button and this button agree; a tool opened by a bookmark or a reload has
  // no such entry, and replacing the URL is what keeps the user in the project
  // instead of sending them to whatever preceded it.
  function close() {
    ref.current?.close();
    if (takePanelPushed()) { router.back(); return; }
    router.replace(closedPanelHref(new URL(window.location.href)), { scroll: false });
  }

  return <dialog
    className={`ws-panel ws-panel-${size}`}
    ref={ref}
    tabIndex={-1}
    aria-labelledby={headingId}
    onCancel={(event) => { event.preventDefault(); close(); }}
    onClick={(event) => { if (event.target === ref.current) close(); }}
  >
    <header className="ws-panel-hd">
      <div>
        <h1 id={headingId}>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      <div className="ws-panel-hd-acts">
        {actions}
        <button type="button" className="ws-panel-close" aria-label="Close and return to the website" onClick={close}><X size={17} /></button>
      </div>
    </header>
    <div className="ws-panel-bd">{children}</div>
  </dialog>;
}

export function DetailDrawer(props: Omit<Parameters<typeof FeaturePanel>[0], "size">) { return <FeaturePanel {...props} size="drawer" />; }
export function FocusedWorkSurface(props: Omit<Parameters<typeof FeaturePanel>[0], "size">) { return <FeaturePanel {...props} size="wide" />; }
