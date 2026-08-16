import { cta, type StarterSection } from "./types";

/**
 * Five product-card sections. The card is the unit here, so the variants differ in what
 * a card is made of: a plain peer grid, a price-led list, a spec table, a filterable
 * catalogue, and a single featured item beside its details.
 */
export const PRODUCT_CARD_STARTERS: StarterSection[] = [
  {
    id: "product-card-grid",
    category: "product_card",
    name: "Peer grid",
    description: "Three equal cards, each with a name, a real sentence and a price. The plain, reliable shape.",
    kind: "card",
    interactive: false,
    build: (context) => `export default function ProductGrid() {
  return (
    <section className="c-section" data-canvas-id="products" data-canvas-label="Products">
      <div className="c-container c-stack">
        <div className="c-stack">
          <p className="c-kicker">What we sell</p>
          <h2>Three things worth naming</h2>
          <p className="c-muted">Replace each card with a real product and a sentence that earns its place.</p>
        </div>
        <div className="c-grid">
          <article className="c-card c-stack" data-canvas-id="product-1">
            <h3>First product</h3>
            <p className="c-muted">One or two sentences describing what it is and who it suits.</p>
            <p><strong>£24</strong></p>
            <a className="c-link" href="${cta(context)}">See details</a>
          </article>
          <article className="c-card c-stack" data-canvas-id="product-2">
            <h3>Second product</h3>
            <p className="c-muted">Keep the descriptions the same length so the row reads evenly.</p>
            <p><strong>£38</strong></p>
            <a className="c-link" href="${cta(context)}">See details</a>
          </article>
          <article className="c-card c-stack" data-canvas-id="product-3">
            <h3>Third product</h3>
            <p className="c-muted">Three or six cards, never five — an orphan on the last row looks broken.</p>
            <p><strong>£52</strong></p>
            <a className="c-link" href="${cta(context)}">See details</a>
          </article>
        </div>
      </div>
    </section>
  );
}
`,
  },
  {
    id: "product-card-price-list",
    category: "product_card",
    name: "Price list",
    description: "A dense bordered list rather than cards. For menus, parts and anything with many items.",
    kind: "card",
    interactive: false,
    build: () => `export default function ProductList() {
  return (
    <section className="c-section c-surface" data-canvas-id="products" data-canvas-label="Products">
      <div className="c-container c-stack">
        <h2>Everything on the list</h2>
        <ul className="c-stack" data-canvas-id="product-list">
          <li className="c-bordered c-rounded c-cluster"><span><strong>First item</strong> <span className="c-muted">— one short line of description</span></span><strong>£9</strong></li>
          <li className="c-bordered c-rounded c-cluster"><span><strong>Second item</strong> <span className="c-muted">— one short line of description</span></span><strong>£12</strong></li>
          <li className="c-bordered c-rounded c-cluster"><span><strong>Third item</strong> <span className="c-muted">— one short line of description</span></span><strong>£15</strong></li>
          <li className="c-bordered c-rounded c-cluster"><span><strong>Fourth item</strong> <span className="c-muted">— one short line of description</span></span><strong>£18</strong></li>
        </ul>
      </div>
    </section>
  );
}
`,
  },
  {
    id: "product-card-specs",
    category: "product_card",
    name: "Cards with specs",
    description: "Each card carries a small definition list. For products chosen on numbers.",
    kind: "card",
    interactive: false,
    build: (context) => `export default function ProductSpecs() {
  return (
    <section className="c-section" data-canvas-id="products" data-canvas-label="Products">
      <div className="c-container c-stack">
        <div className="c-stack"><p className="c-kicker">Compare</p><h2>The details that decide it</h2></div>
        <div className="c-grid">
          <article className="c-card c-stack" data-canvas-id="product-spec-1">
            <h3>Standard</h3>
            <dl className="c-stack">
              <div className="c-cluster"><dt className="c-muted">Capacity</dt><dd>12 units</dd></div>
              <div className="c-cluster"><dt className="c-muted">Lead time</dt><dd>3 days</dd></div>
              <div className="c-cluster"><dt className="c-muted">Warranty</dt><dd>1 year</dd></div>
            </dl>
            <a className="c-button-secondary" href="${cta(context)}">Choose standard</a>
          </article>
          <article className="c-card c-stack" data-canvas-id="product-spec-2">
            <h3>Extended</h3>
            <dl className="c-stack">
              <div className="c-cluster"><dt className="c-muted">Capacity</dt><dd>40 units</dd></div>
              <div className="c-cluster"><dt className="c-muted">Lead time</dt><dd>5 days</dd></div>
              <div className="c-cluster"><dt className="c-muted">Warranty</dt><dd>3 years</dd></div>
            </dl>
            <a className="c-button" href="${cta(context)}">Choose extended</a>
          </article>
          <article className="c-card c-stack" data-canvas-id="product-spec-3">
            <h3>Bespoke</h3>
            <dl className="c-stack">
              <div className="c-cluster"><dt className="c-muted">Capacity</dt><dd>Unlimited</dd></div>
              <div className="c-cluster"><dt className="c-muted">Lead time</dt><dd>By agreement</dd></div>
              <div className="c-cluster"><dt className="c-muted">Warranty</dt><dd>3 years</dd></div>
            </dl>
            <a className="c-button-secondary" href="${cta(context)}">Talk to us</a>
          </article>
        </div>
      </div>
    </section>
  );
}
`,
  },
  {
    id: "product-card-filterable",
    category: "product_card",
    name: "Filterable catalogue",
    description: "Client-side category filters over a card grid. Filtering is local — no search backend is implied.",
    kind: "card",
    interactive: true,
    build: (context) => `"use client";
import { useState } from "react";

const ITEMS = [
  { id: "a", name: "First item", group: "Everyday", copy: "One line about what this is." },
  { id: "b", name: "Second item", group: "Everyday", copy: "One line about what this is." },
  { id: "c", name: "Third item", group: "Seasonal", copy: "One line about what this is." },
  { id: "d", name: "Fourth item", group: "Seasonal", copy: "One line about what this is." },
  { id: "e", name: "Fifth item", group: "Limited", copy: "One line about what this is." },
  { id: "f", name: "Sixth item", group: "Limited", copy: "One line about what this is." },
];
const GROUPS = ["All", "Everyday", "Seasonal", "Limited"];

export default function ProductCatalogue() {
  const [group, setGroup] = useState("All");
  const shown = group === "All" ? ITEMS : ITEMS.filter((item) => item.group === group);
  return (
    <section className="c-section" data-canvas-id="products" data-canvas-label="Products">
      <div className="c-container c-stack">
        <div className="c-stack"><h2>Everything we make</h2><p className="c-muted">Filter by kind.</p></div>
        <div className="c-row" role="group" aria-label="Filter products" data-canvas-id="product-filters">
          {GROUPS.map((name) => (
            <button key={name} type="button" className="c-button-secondary" aria-pressed={name === group} onClick={() => setGroup(name)}>{name}</button>
          ))}
        </div>
        <div className="c-grid" aria-live="polite" data-canvas-id="product-results">
          {shown.map((item) => (
            <article key={item.id} className="c-card c-stack">
              <h3>{item.name}</h3>
              <p className="c-muted">{item.copy}</p>
              <a className="c-link" href="${cta(context)}">See details</a>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
`,
  },
  {
    id: "product-card-featured",
    category: "product_card",
    name: "Featured item",
    description: "One product given a full two-column panel, with the rest reduced to a short list beneath.",
    kind: "card",
    interactive: false,
    build: (context) => `export default function FeaturedProduct() {
  return (
    <section className="c-section" data-canvas-id="products" data-canvas-label="Products">
      <div className="c-container c-stack">
        <div className="c-card c-shadow" data-canvas-id="product-featured">
          <div className="c-grid">
            <div className="c-stack">
              <p className="c-kicker">This month</p>
              <h2>The one thing you want people to see first</h2>
              <p className="c-muted">Two or three sentences. Say what it is, who it is for, and what it costs.</p>
              <div className="c-actions"><a className="c-button" href="${cta(context)}">Order now</a><a className="c-link" href="${cta(context)}">Full details</a></div>
            </div>
            <div className="c-stack">
              <h3>What comes with it</h3>
              <ul className="c-stack">
                <li>The first thing included</li>
                <li>The second thing included</li>
                <li>The third thing included</li>
              </ul>
            </div>
          </div>
        </div>
        <div className="c-row" data-canvas-id="product-others">
          <a className="c-link" href="${cta(context)}">Second product</a>
          <a className="c-link" href="${cta(context)}">Third product</a>
          <a className="c-link" href="${cta(context)}">Fourth product</a>
        </div>
      </div>
    </section>
  );
}
`,
  },
];
