import { navigationLinks, text, type StarterContext, type StarterSection } from "./types";

const links = (context: StarterContext, limit?: number) =>
  navigationLinks(context, limit).map((link) => `          <a className="c-link" href="${link.href}">${text(link.name)}</a>`).join("\n");

const year = "2026";

/**
 * Five footers along one axis that actually matters: how much a site needs to say at the
 * end. A single line, a two-column close, a full sitemap, a newsletter close, and a
 * contact-first footer for businesses people phone.
 */
export const FOOTER_STARTERS: StarterSection[] = [
  {
    id: "footer-minimal",
    category: "footer",
    name: "Single line",
    description: "Name, links and a copyright on one line. Nothing more, for sites that end quietly.",
    kind: "footer",
    interactive: false,
    build: (context) => `export default function Footer() {
  return (
    <footer className="c-section c-surface" data-canvas-id="footer" data-canvas-label="Footer">
      <div className="c-container c-cluster">
        <p className="c-muted">© ${year} ${text(context.companyName)}</p>
        <div className="c-row" data-canvas-id="footer-links">
${links(context)}
        </div>
      </div>
    </footer>
  );
}
`,
  },
  {
    id: "footer-two-column",
    category: "footer",
    name: "Statement and links",
    description: "A short positioning line on the left, navigation on the right. Balanced without a sitemap.",
    kind: "footer",
    interactive: false,
    build: (context) => `export default function Footer() {
  return (
    <footer className="c-section c-surface" data-canvas-id="footer" data-canvas-label="Footer">
      <div className="c-container c-stack">
        <div className="c-grid">
          <div className="c-stack" data-canvas-id="footer-statement">
            <strong>${text(context.companyName)}</strong>
            <p className="c-muted">Replace this line with what you do and who you do it for.</p>
          </div>
          <nav className="c-stack" aria-label="Footer" data-canvas-id="footer-links">
${links(context, 6)}
          </nav>
        </div>
        <p className="c-muted">© ${year} ${text(context.companyName)}. All rights reserved.</p>
      </div>
    </footer>
  );
}
`,
  },
  {
    id: "footer-sitemap",
    category: "footer",
    name: "Grouped sitemap",
    description: "Three labelled link groups plus legal. For larger sites where the footer is real navigation.",
    kind: "footer",
    interactive: false,
    build: (context) => `export default function Footer() {
  return (
    <footer className="c-section c-surface" data-canvas-id="footer" data-canvas-label="Footer">
      <div className="c-container c-stack">
        <div className="c-grid">
          <nav className="c-stack" aria-label="Site" data-canvas-id="footer-group-site">
            <p className="c-kicker">Site</p>
${links(context, 5)}
          </nav>
          <div className="c-stack" data-canvas-id="footer-group-contact">
            <p className="c-kicker">Contact</p>
            <a className="c-link" href="mailto:hello@example.com">hello@example.com</a>
            <a className="c-link" href="tel:+15550100">(555) 010-0</a>
            <p className="c-muted">12 Market Street, Springfield</p>
          </div>
          <div className="c-stack" data-canvas-id="footer-group-hours">
            <p className="c-kicker">Hours</p>
            <p className="c-muted">Monday to Friday, 8am–6pm</p>
            <p className="c-muted">Saturday, 9am–2pm</p>
          </div>
        </div>
        <p className="c-muted">© ${year} ${text(context.companyName)}</p>
      </div>
    </footer>
  );
}
`,
  },
  {
    id: "footer-signup",
    category: "footer",
    name: "Closing sign-up",
    description: "A local sign-up field above the links. The field is visual only — no backend is implied.",
    kind: "footer",
    interactive: true,
    build: (context) => `"use client";
import { useState } from "react";

export default function Footer() {
  const [email, setEmail] = useState("");
  const valid = email.includes("@") && email.length > 4;
  return (
    <footer className="c-section c-surface" data-canvas-id="footer" data-canvas-label="Footer">
      <div className="c-container c-stack">
        <div className="c-card c-stack" data-canvas-id="footer-signup">
          <h2>Occasional news, never noise</h2>
          <p className="c-muted">Connect this form to your own mailing provider before launch — nothing is sent yet.</p>
          <div className="c-actions">
            <label className="c-stack" htmlFor="footer-email">
              <span className="c-muted">Email address</span>
              <input id="footer-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
            </label>
            <button type="button" className="c-button" disabled={!valid}>Sign up</button>
          </div>
          <p className="c-muted" aria-live="polite">{email.length === 0 ? "" : valid ? "That address looks right." : "Enter a full email address."}</p>
        </div>
        <div className="c-cluster">
          <p className="c-muted">© ${year} ${text(context.companyName)}</p>
          <nav className="c-row" aria-label="Footer" data-canvas-id="footer-links">
${links(context)}
          </nav>
        </div>
      </div>
    </footer>
  );
}
`,
  },
  {
    id: "footer-contact-first",
    category: "footer",
    name: "Contact first",
    description: "Phone, address and hours lead; links follow. For businesses people call rather than browse.",
    kind: "footer",
    interactive: false,
    build: (context) => `export default function Footer() {
  return (
    <footer className="c-section c-surface" data-canvas-id="footer" data-canvas-label="Footer">
      <div className="c-container c-stack">
        <div className="c-stack" data-canvas-id="footer-contact">
          <p className="c-kicker">${text(context.companyName)}</p>
          <h2><a className="c-link" href="tel:+15550100">(555) 010-0</a></h2>
          <p className="c-muted">12 Market Street, Springfield · Monday to Saturday</p>
        </div>
        <div className="c-cluster">
          <nav className="c-row" aria-label="Footer" data-canvas-id="footer-links">
${links(context)}
          </nav>
          <p className="c-muted">© ${year} ${text(context.companyName)}</p>
        </div>
      </div>
    </footer>
  );
}
`,
  },
];
