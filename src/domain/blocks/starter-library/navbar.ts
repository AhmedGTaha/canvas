import { cta, home, navigationLinks, text, type StarterSection } from "./types";

const linkList = (context: Parameters<typeof navigationLinks>[0], limit?: number) =>
  navigationLinks(context, limit).map((link) => `        <a className="c-link" href="${link.href}">${text(link.name)}</a>`).join("\n");

/**
 * Five navigation bars that differ in structure, not in trim: a plain bar, a two-tier
 * centred mark, a bar that collapses behind a real toggle on small screens, a bar with a
 * utility strip above it, and one that splits its links around the brand.
 */
export const NAVBAR_STARTERS: StarterSection[] = [
  {
    id: "navbar-classic",
    category: "navbar",
    name: "Classic bar",
    description: "Brand on the left, links and one call to action on the right. The safe default.",
    kind: "navbar",
    interactive: false,
    build: (context) => `export default function Navbar() {
  return (
    <nav className="c-navbar" aria-label="Primary" data-canvas-id="navbar" data-canvas-label="Navigation bar">
      <div className="c-container c-actions">
        <a className="c-nav-brand" href="${home(context)}" data-canvas-id="navbar-brand"><strong>${text(context.companyName)}</strong></a>
        <div className="c-nav-links" data-canvas-id="navbar-links">
${linkList(context)}
          <a className="c-button" href="${cta(context)}">Get in touch</a>
        </div>
      </div>
    </nav>
  );
}
`,
  },
  {
    id: "navbar-centered",
    category: "navbar",
    name: "Centred wordmark",
    description: "Two tiers — the name on its own line, navigation beneath it. Suits editorial and hospitality.",
    kind: "navbar",
    interactive: false,
    build: (context) => `export default function Navbar() {
  return (
    <nav className="c-navbar" aria-label="Primary" data-canvas-id="navbar" data-canvas-label="Navigation bar">
      <div className="c-container c-stack">
        <a className="c-nav-brand" href="${home(context)}" data-canvas-id="navbar-brand"><strong>${text(context.companyName)}</strong></a>
        <div className="c-nav-links" data-canvas-id="navbar-links">
${linkList(context, 6)}
        </div>
      </div>
    </nav>
  );
}
`,
  },
  {
    id: "navbar-mobile-menu",
    category: "navbar",
    name: "Collapsing menu",
    description: "Links collapse behind a labelled toggle on small screens. Keyboard operable, honours reduced motion.",
    kind: "navbar",
    interactive: true,
    build: (context) => `"use client";
import { useState } from "react";

export default function Navbar() {
  const [open, setOpen] = useState(false);
  return (
    <nav className="c-navbar" aria-label="Primary" data-canvas-id="navbar" data-canvas-label="Navigation bar">
      <div className="c-container c-actions">
        <a className="c-nav-brand" href="${home(context)}" data-canvas-id="navbar-brand"><strong>${text(context.companyName)}</strong></a>
        <button type="button" className="c-button-secondary" aria-expanded={open} aria-controls="navbar-menu" onClick={() => setOpen(!open)} data-canvas-id="navbar-toggle">
          {open ? "Close" : "Menu"}
        </button>
        <div className="c-nav-links" id="navbar-menu" hidden={!open} data-canvas-id="navbar-links">
${linkList(context)}
          <a className="c-button" href="${cta(context)}">Get in touch</a>
        </div>
      </div>
    </nav>
  );
}
`,
  },
  {
    id: "navbar-utility-strip",
    category: "navbar",
    name: "Utility strip",
    description: "A thin line of contact details above the main bar. For trades, clinics and anywhere hours matter.",
    kind: "navbar",
    interactive: false,
    build: (context) => `export default function Navbar() {
  return (
    <nav className="c-navbar" aria-label="Primary" data-canvas-id="navbar" data-canvas-label="Navigation bar">
      <div className="c-container c-stack">
        <div className="c-cluster" data-canvas-id="navbar-utility">
          <p className="c-muted">Mon–Fri, 8am–6pm</p>
          <a className="c-link" href="tel:+15550100">Call (555) 010-0</a>
        </div>
        <div className="c-cluster" data-canvas-id="navbar-main">
          <a className="c-nav-brand" href="${home(context)}" data-canvas-id="navbar-brand"><strong>${text(context.companyName)}</strong></a>
          <div className="c-nav-links" data-canvas-id="navbar-links">
${linkList(context)}
          </div>
        </div>
      </div>
    </nav>
  );
}
`,
  },
  {
    id: "navbar-split-cta",
    category: "navbar",
    name: "Split with strong action",
    description: "Navigation on one side, two weighted actions on the other. For sites that sell or book.",
    kind: "navbar",
    interactive: false,
    build: (context) => `export default function Navbar() {
  return (
    <nav className="c-navbar" aria-label="Primary" data-canvas-id="navbar" data-canvas-label="Navigation bar">
      <div className="c-container c-actions">
        <a className="c-nav-brand" href="${home(context)}" data-canvas-id="navbar-brand"><strong>${text(context.companyName)}</strong></a>
        <div className="c-nav-links" data-canvas-id="navbar-links">
${linkList(context, 4)}
        </div>
        <div className="c-actions" data-canvas-id="navbar-actions">
          <a className="c-button-secondary" href="${cta(context)}">Sign in</a>
          <a className="c-button" href="${cta(context)}">Book now</a>
        </div>
      </div>
    </nav>
  );
}
`,
  },
];
