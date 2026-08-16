"use client";

import { ChevronRight } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

/**
 * A titled section that starts collapsed.
 *
 * Progressive disclosure, not hiding: the summary always says what is inside and
 * how much of it there is, so nothing becomes unfindable by being closed. Built on
 * a button/region pair rather than <details> because the open height has to be
 * animatable, and `content-visibility` on a closed <details> cannot be measured.
 *
 * The motion is one property — grid-template-rows from 0fr to 1fr — at --dur-3.
 * It is the shortest honest description of "this is expanding", it interrupts
 * cleanly, and it collapses to an instant swap under reduced motion, which the
 * stylesheet handles rather than this component.
 */
export function Disclosure({ title, hint, defaultOpen = false, children }: {
  title: ReactNode;
  hint?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const regionId = useId();
  const triggerId = useId();

  return <div className="disclosure" data-open={open ? "on" : "off"}>
    <button type="button" id={triggerId} className="disclosure-summary" aria-expanded={open} aria-controls={regionId} onClick={() => setOpen((value) => !value)}>
      <ChevronRight className="disclosure-chevron" size={15} aria-hidden="true" />
      <span className="disclosure-title">{title}</span>
      {hint ? <span className="disclosure-hint">{hint}</span> : null}
    </button>
    {/* The region stays mounted so its height is animatable; `inert` is what
        actually takes it out of the tab order and the accessibility tree while
        it is closed, which `hidden` would do at the cost of the transition. */}
    <div className="disclosure-region" id={regionId} role="group" aria-labelledby={triggerId} inert={!open}>
      <div className="disclosure-region-inner">{children}</div>
    </div>
  </div>;
}
