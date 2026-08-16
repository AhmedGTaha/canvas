import { cta, text, type StarterSection } from "./types";

/**
 * Five heroes that differ in what carries the page: a claim, a split with proof, a
 * measured stat row, a search-style entry point, and an announcement-led launch hero.
 */
export const HERO_STARTERS: StarterSection[] = [
  {
    id: "hero-statement",
    category: "hero",
    name: "Single claim",
    description: "One headline, one supporting line, one action. The most confident hero there is.",
    kind: "hero",
    interactive: false,
    build: (context) => `export default function Hero() {
  return (
    <section className="c-section c-hero" data-canvas-id="hero" data-canvas-label="Hero">
      <div className="c-container c-stack">
        <p className="c-kicker">${text(context.companyName)}</p>
        <h1>Replace this with one specific claim about what you do</h1>
        <p className="c-muted">One supporting sentence naming who it is for and what changes for them.</p>
        <div className="c-actions">
          <a className="c-button" href="${cta(context)}">Start here</a>
          <a className="c-link" href="${cta(context)}">See how it works</a>
        </div>
      </div>
    </section>
  );
}
`,
  },
  {
    id: "hero-split-proof",
    category: "hero",
    name: "Split with proof",
    description: "Claim on one side, a bordered proof panel on the other. Good when credibility is the hurdle.",
    kind: "hero",
    interactive: false,
    build: (context) => `export default function Hero() {
  return (
    <section className="c-section c-hero" data-canvas-id="hero" data-canvas-label="Hero">
      <div className="c-container">
        <div className="c-grid">
          <div className="c-stack" data-canvas-id="hero-claim">
            <p className="c-kicker">Since 2011</p>
            <h1>A headline that names the outcome, not the category</h1>
            <p className="c-muted">Two sentences at most. Say what you do, who for, and how quickly.</p>
            <div className="c-actions"><a className="c-button" href="${cta(context)}">Request a quote</a></div>
          </div>
          <div className="c-card c-stack" data-canvas-id="hero-proof">
            <h2>Why people choose us</h2>
            <ul className="c-stack">
              <li>Fixed quotes, agreed before any work starts</li>
              <li>Fully insured crews, on site within 24 hours</li>
              <li>Two-year workmanship guarantee in writing</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
`,
  },
  {
    id: "hero-stat-band",
    category: "hero",
    name: "Claim over stats",
    description: "A centred claim above a tight row of figures. Denser than a plain hero, and earns the space.",
    kind: "hero",
    interactive: false,
    build: (context) => `export default function Hero() {
  return (
    <section className="c-section c-hero" data-canvas-id="hero" data-canvas-label="Hero">
      <div className="c-container c-stack">
        <div className="c-stack" data-canvas-id="hero-claim">
          <h1>The claim your best customer would repeat to a friend</h1>
          <p className="c-muted">One line of support. Keep it concrete.</p>
          <div className="c-actions"><a className="c-button" href="${cta(context)}">Get started</a><a className="c-button-secondary" href="${cta(context)}">Talk to us</a></div>
        </div>
        <div className="c-row" data-canvas-id="hero-stats">
          <div className="c-stack"><h2>1,400+</h2><p className="c-muted">Projects delivered</p></div>
          <div className="c-stack"><h2>24h</h2><p className="c-muted">Typical response</p></div>
          <div className="c-stack"><h2>12 yrs</h2><p className="c-muted">In business</p></div>
        </div>
      </div>
    </section>
  );
}
`,
  },
  {
    id: "hero-entry-search",
    category: "hero",
    name: "Guided entry",
    description: "A hero that starts a task rather than describing one. The field filters locally; nothing is submitted.",
    kind: "hero",
    interactive: true,
    build: (context) => `"use client";
import { useState } from "react";

const OPTIONS = ["Emergency repair", "Planned maintenance", "New installation", "Inspection and report"];

export default function Hero() {
  const [query, setQuery] = useState("");
  const matches = OPTIONS.filter((option) => option.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <section className="c-section c-hero" data-canvas-id="hero" data-canvas-label="Hero">
      <div className="c-container c-stack">
        <h1>Tell us what you need and we will price it today</h1>
        <p className="c-muted">Start typing to find the service you are after. This filters the list on the page and does not send anything.</p>
        <label className="c-stack" htmlFor="hero-search">
          <span className="c-muted">What do you need?</span>
          <input id="hero-search" type="text" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Emergency repair" />
        </label>
        <ul className="c-stack" aria-live="polite" data-canvas-id="hero-matches">
          {matches.map((option) => <li key={option}><a className="c-link" href="${cta(context)}">{option}</a></li>)}
          {matches.length === 0 ? <li className="c-muted">Nothing matches that yet — call us and we will help.</li> : null}
        </ul>
      </div>
    </section>
  );
}
`,
  },
  {
    id: "hero-announcement",
    category: "hero",
    name: "Announcement led",
    description: "A dated notice above the claim. For openings, launches, seasonal menus and campaigns.",
    kind: "hero",
    interactive: false,
    build: (context) => `export default function Hero() {
  return (
    <section className="c-section c-hero c-surface" data-canvas-id="hero" data-canvas-label="Hero">
      <div className="c-container c-stack">
        <div className="c-card c-stack" data-canvas-id="hero-announcement">
          <p className="c-kicker">New this season</p>
          <p>Replace this with the thing you want people to know first.</p>
        </div>
        <h1>${text(context.companyName)}, in one honest sentence</h1>
        <p className="c-muted">One line of support, then get out of the way.</p>
        <div className="c-actions"><a className="c-button" href="${cta(context)}">See what is on</a></div>
      </div>
    </section>
  );
}
`,
  },
];
