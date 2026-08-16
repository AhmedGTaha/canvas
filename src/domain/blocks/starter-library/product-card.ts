import { cta, type StarterSection } from "./types";

const listReset = `.item-list{list-style:none;margin:0;padding:0}.spec-list{margin:0}.spec-list dd{margin:0}`;

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
    build: (context) => ({
      html: `<section class="c-section" data-canvas-id="products" data-canvas-label="Products">
      <div class="c-container c-stack">
        <div class="c-stack">
          <p class="c-kicker">What we sell</p>
          <h2>Three things worth naming</h2>
          <p class="c-muted">Replace each card with a real product and a sentence that earns its place.</p>
        </div>
        <div class="c-grid">
          <article class="c-card c-stack" data-canvas-id="product-1">
            <h3>First product</h3>
            <p class="c-muted">One or two sentences describing what it is and who it suits.</p>
            <p><strong>£24</strong></p>
            <a class="c-link" href="${cta(context)}">See details</a>
          </article>
          <article class="c-card c-stack" data-canvas-id="product-2">
            <h3>Second product</h3>
            <p class="c-muted">Keep the descriptions the same length so the row reads evenly.</p>
            <p><strong>£38</strong></p>
            <a class="c-link" href="${cta(context)}">See details</a>
          </article>
          <article class="c-card c-stack" data-canvas-id="product-3">
            <h3>Third product</h3>
            <p class="c-muted">Three or six cards, never five — an orphan on the last row looks broken.</p>
            <p><strong>£52</strong></p>
            <a class="c-link" href="${cta(context)}">See details</a>
          </article>
        </div>
      </div>
    </section>`,
    }),
  },
  {
    id: "product-card-price-list",
    category: "product_card",
    name: "Price list",
    description: "A dense bordered list rather than cards. For menus, parts and anything with many items.",
    kind: "card",
    interactive: false,
    build: () => ({
      html: `<section class="c-section c-surface" data-canvas-id="products" data-canvas-label="Products">
      <div class="c-container c-stack">
        <h2>Everything on the list</h2>
        <ul class="c-stack item-list" data-canvas-id="product-list">
          <li class="c-bordered c-rounded c-cluster item-row"><span><strong>First item</strong> <span class="c-muted">— one short line of description</span></span><strong>£9</strong></li>
          <li class="c-bordered c-rounded c-cluster item-row"><span><strong>Second item</strong> <span class="c-muted">— one short line of description</span></span><strong>£12</strong></li>
          <li class="c-bordered c-rounded c-cluster item-row"><span><strong>Third item</strong> <span class="c-muted">— one short line of description</span></span><strong>£15</strong></li>
          <li class="c-bordered c-rounded c-cluster item-row"><span><strong>Fourth item</strong> <span class="c-muted">— one short line of description</span></span><strong>£18</strong></li>
        </ul>
      </div>
    </section>`,
      css: `${listReset}.item-row{padding:var(--space-md)}`,
    }),
  },
  {
    id: "product-card-specs",
    category: "product_card",
    name: "Cards with specs",
    description: "Each card carries a small definition list. For products chosen on numbers.",
    kind: "card",
    interactive: false,
    build: (context) => ({
      html: `<section class="c-section" data-canvas-id="products" data-canvas-label="Products">
      <div class="c-container c-stack">
        <div class="c-stack"><p class="c-kicker">Compare</p><h2>The details that decide it</h2></div>
        <div class="c-grid">
          <article class="c-card c-stack" data-canvas-id="product-spec-1">
            <h3>Standard</h3>
            <dl class="c-stack spec-list">
              <div class="c-cluster"><dt class="c-muted">Capacity</dt><dd>12 units</dd></div>
              <div class="c-cluster"><dt class="c-muted">Lead time</dt><dd>3 days</dd></div>
              <div class="c-cluster"><dt class="c-muted">Warranty</dt><dd>1 year</dd></div>
            </dl>
            <a class="c-button-secondary" href="${cta(context)}">Choose standard</a>
          </article>
          <article class="c-card c-stack" data-canvas-id="product-spec-2">
            <h3>Extended</h3>
            <dl class="c-stack spec-list">
              <div class="c-cluster"><dt class="c-muted">Capacity</dt><dd>40 units</dd></div>
              <div class="c-cluster"><dt class="c-muted">Lead time</dt><dd>5 days</dd></div>
              <div class="c-cluster"><dt class="c-muted">Warranty</dt><dd>3 years</dd></div>
            </dl>
            <a class="c-button" href="${cta(context)}">Choose extended</a>
          </article>
          <article class="c-card c-stack" data-canvas-id="product-spec-3">
            <h3>Bespoke</h3>
            <dl class="c-stack spec-list">
              <div class="c-cluster"><dt class="c-muted">Capacity</dt><dd>Unlimited</dd></div>
              <div class="c-cluster"><dt class="c-muted">Lead time</dt><dd>By agreement</dd></div>
              <div class="c-cluster"><dt class="c-muted">Warranty</dt><dd>3 years</dd></div>
            </dl>
            <a class="c-button-secondary" href="${cta(context)}">Talk to us</a>
          </article>
        </div>
      </div>
    </section>`,
      css: listReset,
    }),
  },
  {
    id: "product-card-filterable",
    category: "product_card",
    name: "Filterable catalogue",
    description: "Client-side category filters over a card grid. Filtering is local — no search backend is implied.",
    kind: "card",
    interactive: true,
    build: (context) => ({
      html: `<section class="c-section" data-canvas-id="products" data-canvas-label="Products">
      <div class="c-container c-stack">
        <div class="c-stack"><h2>Everything we make</h2><p class="c-muted">Filter by kind.</p></div>
        <div class="c-row" role="group" aria-label="Filter products" data-canvas-id="product-filters">
          <button type="button" class="c-button-secondary item-filter" data-group="All" aria-pressed="true">All</button>
          <button type="button" class="c-button-secondary item-filter" data-group="Everyday" aria-pressed="false">Everyday</button>
          <button type="button" class="c-button-secondary item-filter" data-group="Seasonal" aria-pressed="false">Seasonal</button>
          <button type="button" class="c-button-secondary item-filter" data-group="Limited" aria-pressed="false">Limited</button>
        </div>
        <div class="c-grid" aria-live="polite" data-canvas-id="product-results">
          <article class="c-card c-stack item-card" data-group="Everyday"><h3>First item</h3><p class="c-muted">One line about what this is.</p><a class="c-link" href="${cta(context)}">See details</a></article>
          <article class="c-card c-stack item-card" data-group="Everyday"><h3>Second item</h3><p class="c-muted">One line about what this is.</p><a class="c-link" href="${cta(context)}">See details</a></article>
          <article class="c-card c-stack item-card" data-group="Seasonal"><h3>Third item</h3><p class="c-muted">One line about what this is.</p><a class="c-link" href="${cta(context)}">See details</a></article>
          <article class="c-card c-stack item-card" data-group="Seasonal"><h3>Fourth item</h3><p class="c-muted">One line about what this is.</p><a class="c-link" href="${cta(context)}">See details</a></article>
          <article class="c-card c-stack item-card" data-group="Limited"><h3>Fifth item</h3><p class="c-muted">One line about what this is.</p><a class="c-link" href="${cta(context)}">See details</a></article>
          <article class="c-card c-stack item-card" data-group="Limited"><h3>Sixth item</h3><p class="c-muted">One line about what this is.</p><a class="c-link" href="${cta(context)}">See details</a></article>
        </div>
      </div>
    </section>`,
      css: `${listReset}.item-filter[aria-pressed="true"]{border-color:var(--color-accent);color:var(--color-accent)}`,
      js: `var filters = document.querySelectorAll(".item-filter");
var cards = document.querySelectorAll(".item-card");
function apply(group) {
  for (var f = 0; f < filters.length; f += 1) {
    filters[f].setAttribute("aria-pressed", filters[f].getAttribute("data-group") === group ? "true" : "false");
  }
  for (var c = 0; c < cards.length; c += 1) {
    var matches = group === "All" || cards[c].getAttribute("data-group") === group;
    if (matches) cards[c].removeAttribute("hidden"); else cards[c].setAttribute("hidden", "");
  }
}
for (var index = 0; index < filters.length; index += 1) {
  filters[index].addEventListener("click", function (event) {
    apply(event.currentTarget.getAttribute("data-group"));
  });
}`,
    }),
  },
  {
    id: "product-card-featured",
    category: "product_card",
    name: "Featured item",
    description: "One product given a full two-column panel, with the rest reduced to a short list beneath.",
    kind: "card",
    interactive: false,
    build: (context) => ({
      html: `<section class="c-section" data-canvas-id="products" data-canvas-label="Products">
      <div class="c-container c-stack">
        <div class="c-card c-shadow" data-canvas-id="product-featured">
          <div class="c-grid">
            <div class="c-stack">
              <p class="c-kicker">This month</p>
              <h2>The one thing you want people to see first</h2>
              <p class="c-muted">Two or three sentences. Say what it is, who it is for, and what it costs.</p>
              <div class="c-actions"><a class="c-button" href="${cta(context)}">Order now</a><a class="c-link" href="${cta(context)}">Full details</a></div>
            </div>
            <div class="c-stack">
              <h3>What comes with it</h3>
              <ul class="c-stack item-list">
                <li>The first thing included</li>
                <li>The second thing included</li>
                <li>The third thing included</li>
              </ul>
            </div>
          </div>
        </div>
        <div class="c-row" data-canvas-id="product-others">
          <a class="c-link" href="${cta(context)}">Second product</a>
          <a class="c-link" href="${cta(context)}">Third product</a>
          <a class="c-link" href="${cta(context)}">Fourth product</a>
        </div>
      </div>
    </section>`,
      css: listReset,
    }),
  },
];
