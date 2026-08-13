"use client";

import { useEffect, useRef } from "react";

/**
 * An anchor a sidebar row can open a panel at.
 *
 * The Design sidebar names two parts of Brand & design; without this both rows
 * opened the panel at the top and the second row was indistinguishable from the
 * first. It renders nothing and only scrolls once, on the render that asked for
 * it, so it never fights the user for the scroll position afterwards.
 */
export function PanelSection({ focus }: { focus: boolean }) {
  const marker = useRef<HTMLSpanElement>(null);
  const scrolled = useRef(false);
  useEffect(() => {
    if (!focus || scrolled.current) return;
    scrolled.current = true;
    marker.current?.scrollIntoView({ block: "start" });
  }, [focus]);
  return <span ref={marker} aria-hidden="true" />;
}
