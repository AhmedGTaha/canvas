"use client";

import { useEffect, useRef, useState } from "react";
import { PREVIEW_IFRAME_SANDBOX } from "@/generated-runtime/security/headers";

export function starterPreviewUrl(token: string, starterId: string, mode: "light" | "dark", instanceId: string) {
  return `/preview/${encodeURIComponent(token)}?starter=${encodeURIComponent(starterId)}&mode=${mode}&instance=${instanceId}`;
}

/**
 * Real starter previews compile on the server. A library can have dozens of choices,
 * so each card waits until it enters its scroll viewport before starting that work.
 */
export function StarterPreviewCard({ src, name, scrollRootSelector = ".starter-picker-list" }: { src: string | null; name: string; scrollRootSelector?: string }) {
  const frame = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = frame.current;
    if (!element || !src) return;
    if (typeof IntersectionObserver === "undefined") { const fallback = window.setTimeout(() => setVisible(true), 0); return () => window.clearTimeout(fallback); }
    const observer = new IntersectionObserver(([entry]) => { if (entry?.isIntersecting) setVisible(true); }, { root: element.closest(scrollRootSelector) });
    observer.observe(element);
    return () => observer.disconnect();
  }, [scrollRootSelector, src]);

  return <div className="starter-card-preview" ref={frame}>{visible && src ? <iframe src={src} sandbox={PREVIEW_IFRAME_SANDBOX} tabIndex={-1} title={`${name} card preview`} /> : <span>{src ? "Loading preview…" : "Preparing preview…"}</span>}</div>;
}
