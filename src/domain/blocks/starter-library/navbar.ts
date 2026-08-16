import { cta, home, navigationLinks, text, type StarterSection } from "./types";

const linkList = (context: Parameters<typeof navigationLinks>[0], limit?: number) =>
  navigationLinks(context, limit).map((link) => `        <a class="c-link" href="${link.href}">${text(link.name)}</a>`).join("\n");

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
    build: (context) => ({
      html: `<nav class="c-navbar" aria-label="Primary" data-canvas-id="navbar" data-canvas-label="Navigation bar">
      <div class="c-container c-actions">
        <a class="c-nav-brand" href="${home(context)}" data-canvas-id="navbar-brand"><strong>${text(context.companyName)}</strong></a>
        <div class="c-nav-links" data-canvas-id="navbar-links">
${linkList(context)}
          <a class="c-button" href="${cta(context)}">Get in touch</a>
        </div>
      </div>
    </nav>`,
    }),
  },
  {
    id: "navbar-centered",
    category: "navbar",
    name: "Centred wordmark",
    description: "Two tiers — the name on its own line, navigation beneath it. Suits editorial and hospitality.",
    kind: "navbar",
    interactive: false,
    build: (context) => ({
      html: `<nav class="c-navbar" aria-label="Primary" data-canvas-id="navbar" data-canvas-label="Navigation bar">
      <div class="c-container c-stack navbar-centred">
        <a class="c-nav-brand" href="${home(context)}" data-canvas-id="navbar-brand"><strong>${text(context.companyName)}</strong></a>
        <div class="c-nav-links" data-canvas-id="navbar-links">
${linkList(context, 6)}
        </div>
      </div>
    </nav>`,
      css: `.navbar-centred{align-items:center;text-align:center}.navbar-centred .c-nav-links{justify-content:center}`,
    }),
  },
  {
    id: "navbar-mobile-menu",
    category: "navbar",
    name: "Collapsing menu",
    description: "Links collapse behind a labelled toggle on small screens. Keyboard operable, honours reduced motion.",
    kind: "navbar",
    interactive: true,
    build: (context) => ({
      html: `<nav class="c-navbar" aria-label="Primary" data-canvas-id="navbar" data-canvas-label="Navigation bar">
      <div class="c-container c-actions">
        <a class="c-nav-brand" href="${home(context)}" data-canvas-id="navbar-brand"><strong>${text(context.companyName)}</strong></a>
        <button type="button" class="c-button-secondary navbar-toggle" aria-expanded="false" aria-controls="navbar-menu" data-canvas-id="navbar-toggle">Menu</button>
        <div class="c-nav-links" id="navbar-menu" hidden data-canvas-id="navbar-links">
${linkList(context)}
          <a class="c-button" href="${cta(context)}">Get in touch</a>
        </div>
      </div>
    </nav>`,
      // The runtime stylesheet already reveals the links above the phone breakpoint and
      // hides any control carrying aria-controls there, so this needs no media query.
      js: `var toggle = document.querySelector(".navbar-toggle");
var menu = document.getElementById("navbar-menu");
if (toggle && menu) {
  toggle.addEventListener("click", function () {
    var open = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", open ? "false" : "true");
    toggle.textContent = open ? "Menu" : "Close";
    if (open) menu.setAttribute("hidden", ""); else menu.removeAttribute("hidden");
  });
}`,
    }),
  },
  {
    id: "navbar-utility-strip",
    category: "navbar",
    name: "Utility strip",
    description: "A thin line of contact details above the main bar. For trades, clinics and anywhere hours matter.",
    kind: "navbar",
    interactive: false,
    build: (context) => ({
      html: `<nav class="c-navbar" aria-label="Primary" data-canvas-id="navbar" data-canvas-label="Navigation bar">
      <div class="c-container c-stack">
        <div class="c-cluster navbar-utility" data-canvas-id="navbar-utility">
          <p class="c-muted">Mon–Fri, 8am–6pm</p>
          <a class="c-link" href="tel:+15550100">Call (555) 010-0</a>
        </div>
        <div class="c-cluster" data-canvas-id="navbar-main">
          <a class="c-nav-brand" href="${home(context)}" data-canvas-id="navbar-brand"><strong>${text(context.companyName)}</strong></a>
          <div class="c-nav-links" data-canvas-id="navbar-links">
${linkList(context)}
          </div>
        </div>
      </div>
    </nav>`,
      css: `.navbar-utility{padding-bottom:var(--space-sm);border-bottom:var(--border-width) solid var(--color-border);font-size:.85em}`,
    }),
  },
  {
    id: "navbar-split-cta",
    category: "navbar",
    name: "Split with strong action",
    description: "Navigation on one side, two weighted actions on the other. For sites that sell or book.",
    kind: "navbar",
    interactive: false,
    build: (context) => ({
      html: `<nav class="c-navbar" aria-label="Primary" data-canvas-id="navbar" data-canvas-label="Navigation bar">
      <div class="c-container c-actions">
        <a class="c-nav-brand" href="${home(context)}" data-canvas-id="navbar-brand"><strong>${text(context.companyName)}</strong></a>
        <div class="c-nav-links" data-canvas-id="navbar-links">
${linkList(context, 4)}
        </div>
        <div class="c-actions" data-canvas-id="navbar-actions">
          <a class="c-button-secondary" href="${cta(context)}">Sign in</a>
          <a class="c-button" href="${cta(context)}">Book now</a>
        </div>
      </div>
    </nav>`,
    }),
  },
];
