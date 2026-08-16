import { cta, type StarterSection } from "./types";

/**
 * Five services sections: a peer grid, a numbered process, an alternating detail list,
 * a tabbed set for audiences that need different things, and a comparison of what is and
 * is not included.
 */
export const SERVICES_STARTERS: StarterSection[] = [
  {
    id: "services-grid",
    category: "services",
    name: "Service grid",
    description: "Three or six equal services, each with a heading and two real sentences.",
    kind: "section",
    interactive: false,
    build: (context) => `export default function Services() {
  return (
    <section className="c-section" data-canvas-id="services" data-canvas-label="Services">
      <div className="c-container c-stack">
        <div className="c-stack"><p className="c-kicker">What we do</p><h2>Three things we are genuinely good at</h2><p className="c-muted">Replace each card with a service you actually sell.</p></div>
        <div className="c-grid">
          <article className="c-card c-stack" data-canvas-id="service-1"><h3>First service</h3><p className="c-muted">Two sentences. What it is, and what someone gets at the end of it.</p><a className="c-link" href="${cta(context)}">More about this</a></article>
          <article className="c-card c-stack" data-canvas-id="service-2"><h3>Second service</h3><p className="c-muted">Two sentences. What it is, and what someone gets at the end of it.</p><a className="c-link" href="${cta(context)}">More about this</a></article>
          <article className="c-card c-stack" data-canvas-id="service-3"><h3>Third service</h3><p className="c-muted">Two sentences. What it is, and what someone gets at the end of it.</p><a className="c-link" href="${cta(context)}">More about this</a></article>
        </div>
      </div>
    </section>
  );
}
`,
  },
  {
    id: "services-process",
    category: "services",
    name: "Numbered process",
    description: "Four ordered steps. For work where the worry is 'what actually happens'.",
    kind: "section",
    interactive: false,
    build: () => `export default function Process() {
  return (
    <section className="c-section c-surface" data-canvas-id="process" data-canvas-label="How it works">
      <div className="c-container c-stack">
        <div className="c-stack"><p className="c-kicker">How it works</p><h2>Four steps, start to finish</h2></div>
        <ol className="c-grid" data-canvas-id="process-steps">
          <li className="c-card c-stack"><p className="c-kicker">Step one</p><h3>You get in touch</h3><p className="c-muted">Say what you need. We reply the same working day.</p></li>
          <li className="c-card c-stack"><p className="c-kicker">Step two</p><h3>We take a look</h3><p className="c-muted">A visit or a call, at no charge, so the quote is real.</p></li>
          <li className="c-card c-stack"><p className="c-kicker">Step three</p><h3>You get a fixed price</h3><p className="c-muted">In writing, with dates, valid for 30 days.</p></li>
          <li className="c-card c-stack"><p className="c-kicker">Step four</p><h3>We do the work</h3><p className="c-muted">On the agreed dates, cleared up afterwards.</p></li>
        </ol>
      </div>
    </section>
  );
}
`,
  },
  {
    id: "services-alternating",
    category: "services",
    name: "Alternating detail",
    description: "Two-column rows, one service at a time, with room for a real explanation.",
    kind: "section",
    interactive: false,
    build: (context) => `export default function ServiceDetail() {
  return (
    <section className="c-section" data-canvas-id="services" data-canvas-label="Services">
      <div className="c-container c-stack">
        <div className="c-grid" data-canvas-id="service-detail-1">
          <div className="c-stack"><p className="c-kicker">Service one</p><h2>Given enough room to explain itself</h2><p className="c-muted">Three or four sentences. What the work involves, who it suits, what it costs roughly, and how long it takes.</p><div className="c-actions"><a className="c-button-secondary" href="${cta(context)}">Ask about this</a></div></div>
          <div className="c-card c-stack"><h3>Included</h3><ul className="c-stack"><li>The first thing included</li><li>The second thing included</li><li>The third thing included</li></ul></div>
        </div>
        <div className="c-grid" data-canvas-id="service-detail-2">
          <div className="c-card c-stack"><h3>Included</h3><ul className="c-stack"><li>The first thing included</li><li>The second thing included</li><li>The third thing included</li></ul></div>
          <div className="c-stack"><p className="c-kicker">Service two</p><h2>The second one, with the sides swapped</h2><p className="c-muted">Alternating the panel side is what stops a long page of services reading as one long list.</p><div className="c-actions"><a className="c-button-secondary" href="${cta(context)}">Ask about this</a></div></div>
        </div>
      </div>
    </section>
  );
}
`,
  },
  {
    id: "services-tabs",
    category: "services",
    name: "By audience",
    description: "Tabs for different kinds of customer. Real tab semantics, keyboard reachable.",
    kind: "section",
    interactive: true,
    build: () => `"use client";
import { useState } from "react";

const AUDIENCES = [
  { id: "home", label: "Homeowners", heading: "For homes", copy: "What you do for households, in two or three sentences.", points: ["Fixed prices", "Evening appointments", "Two-year guarantee"] },
  { id: "trade", label: "Trade", heading: "For trade", copy: "What you do for other trades, in two or three sentences.", points: ["Account terms", "Priority slots", "Bulk pricing"] },
  { id: "commercial", label: "Commercial", heading: "For commercial sites", copy: "What you do for businesses, in two or three sentences.", points: ["Out-of-hours work", "Compliance reporting", "Named contact"] },
];

export default function ServicesByAudience() {
  const [active, setActive] = useState(AUDIENCES[0].id);
  const current = AUDIENCES.find((item) => item.id === active) ?? AUDIENCES[0];
  return (
    <section className="c-section" data-canvas-id="services" data-canvas-label="Services">
      <div className="c-container c-stack">
        <div className="c-stack"><p className="c-kicker">What we do</p><h2>Different work for different customers</h2></div>
        <div className="c-row" role="tablist" aria-label="Who you are" data-canvas-id="services-tabs">
          {AUDIENCES.map((item) => (
            <button key={item.id} type="button" role="tab" id={"services-tab-" + item.id} className="c-button-secondary" aria-selected={item.id === active} aria-controls="services-panel" onClick={() => setActive(item.id)}>{item.label}</button>
          ))}
        </div>
        <div className="c-card c-stack" role="tabpanel" id="services-panel" aria-labelledby={"services-tab-" + current.id} data-canvas-id="services-panel">
          <h3>{current.heading}</h3>
          <p className="c-muted">{current.copy}</p>
          <ul className="c-stack">{current.points.map((point) => <li key={point}>{point}</li>)}</ul>
        </div>
      </div>
    </section>
  );
}
`,
  },
  {
    id: "services-scope",
    category: "services",
    name: "In scope, out of scope",
    description: "Two honest columns: what you do and what you do not. Saves everyone a phone call.",
    kind: "section",
    interactive: false,
    build: () => `export default function ServiceScope() {
  return (
    <section className="c-section c-surface" data-canvas-id="services" data-canvas-label="Services">
      <div className="c-container c-stack">
        <div className="c-stack"><p className="c-kicker">Scope</p><h2>What we take on, and what we do not</h2><p className="c-muted">Being clear about the second half is what makes the first half believable.</p></div>
        <div className="c-grid">
          <div className="c-card c-stack" data-canvas-id="services-in-scope">
            <h3>We do this</h3>
            <ul className="c-stack"><li>The first thing you do</li><li>The second thing you do</li><li>The third thing you do</li><li>The fourth thing you do</li></ul>
          </div>
          <div className="c-card c-stack" data-canvas-id="services-out-of-scope">
            <h3>We do not do this</h3>
            <ul className="c-stack"><li>The first thing you refer on</li><li>The second thing you refer on</li><li>The third thing you refer on</li></ul>
            <p className="c-muted">We will happily point you at someone who does.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
`,
  },
];
