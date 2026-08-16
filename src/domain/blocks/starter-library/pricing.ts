import { cta, type StarterSection } from "./types";

const listReset = `.plan-list{list-style:none;margin:0;padding:0}.rate-list{list-style:none;margin:0;padding:0}`;

/**
 * Five pricing sections: three tiers, two tiers, a rate card, a monthly/yearly toggle,
 * and a quote-led section for work that cannot be priced on a page.
 */
export const PRICING_STARTERS: StarterSection[] = [
  {
    id: "pricing-three-tier",
    category: "pricing",
    name: "Three tiers",
    description: "The standard shape: three plans, one recommended, each with a real feature list.",
    kind: "pricing",
    interactive: false,
    build: (context) => ({
      html: `<section class="c-section" data-canvas-id="pricing" data-canvas-label="Pricing">
      <div class="c-container c-stack">
        <div class="c-stack"><p class="c-kicker">Pricing</p><h2>Three ways to work with us</h2><p class="c-muted">Replace these plans and prices with your own.</p></div>
        <div class="c-grid">
          <article class="c-card c-stack" data-canvas-id="pricing-starter">
            <h3>Starter</h3>
            <p><strong>£29</strong> <span class="c-muted">per month</span></p>
            <ul class="c-stack plan-list"><li>The first thing included</li><li>The second thing included</li><li>The third thing included</li></ul>
            <a class="c-button-secondary" href="${cta(context)}">Choose Starter</a>
          </article>
          <article class="c-card c-shadow c-stack" data-canvas-id="pricing-standard">
            <p class="c-kicker">Most chosen</p>
            <h3>Standard</h3>
            <p><strong>£79</strong> <span class="c-muted">per month</span></p>
            <ul class="c-stack plan-list"><li>Everything in Starter</li><li>The thing that makes this the popular one</li><li>Priority support</li></ul>
            <a class="c-button" href="${cta(context)}">Choose Standard</a>
          </article>
          <article class="c-card c-stack" data-canvas-id="pricing-complete">
            <h3>Complete</h3>
            <p><strong>£149</strong> <span class="c-muted">per month</span></p>
            <ul class="c-stack plan-list"><li>Everything in Standard</li><li>The thing larger customers need</li><li>A named contact</li></ul>
            <a class="c-button-secondary" href="${cta(context)}">Choose Complete</a>
          </article>
        </div>
      </div>
    </section>`,
      css: listReset,
    }),
  },
  {
    id: "pricing-two-tier",
    category: "pricing",
    name: "Two tiers",
    description: "One plan and one 'talk to us'. Honest when the second half of the market is bespoke.",
    kind: "pricing",
    interactive: false,
    build: (context) => ({
      html: `<section class="c-section c-surface" data-canvas-id="pricing" data-canvas-label="Pricing">
      <div class="c-container c-stack">
        <h2>Simple, and then bespoke</h2>
        <div class="c-grid">
          <article class="c-card c-stack" data-canvas-id="pricing-standard">
            <h3>Standard</h3>
            <p><strong>£79</strong> <span class="c-muted">per month, billed monthly</span></p>
            <p class="c-muted">Everything most customers need, with nothing to configure.</p>
            <ul class="c-stack plan-list"><li>The first thing included</li><li>The second thing included</li><li>The third thing included</li></ul>
            <a class="c-button" href="${cta(context)}">Get started</a>
          </article>
          <article class="c-card c-stack" data-canvas-id="pricing-bespoke">
            <h3>Bespoke</h3>
            <p><strong>Priced per project</strong></p>
            <p class="c-muted">For work with its own shape. We scope it, quote it, then build it.</p>
            <ul class="c-stack plan-list"><li>A scoping session</li><li>A fixed written quote</li><li>A named contact throughout</li></ul>
            <a class="c-button-secondary" href="${cta(context)}">Talk to us</a>
          </article>
        </div>
      </div>
    </section>`,
      css: listReset,
    }),
  },
  {
    id: "pricing-rate-card",
    category: "pricing",
    name: "Rate card",
    description: "A flat list of jobs and prices. For trades and services priced per task, not per month.",
    kind: "pricing",
    interactive: false,
    build: () => ({
      html: `<section class="c-section" data-canvas-id="pricing" data-canvas-label="Pricing">
      <div class="c-container c-stack">
        <div class="c-stack"><h2>What things cost</h2><p class="c-muted">Prices include labour and VAT. Anything unusual is quoted before work starts.</p></div>
        <ul class="c-stack rate-list" data-canvas-id="pricing-rates">
          <li class="c-bordered c-rounded c-cluster rate-row"><span><strong>Call-out and diagnosis</strong><br><span class="c-muted">Waived if we do the work</span></span><strong>£65</strong></li>
          <li class="c-bordered c-rounded c-cluster rate-row"><span><strong>Standard repair</strong><br><span class="c-muted">Up to two hours on site</span></span><strong>£140</strong></li>
          <li class="c-bordered c-rounded c-cluster rate-row"><span><strong>Annual service</strong><br><span class="c-muted">Includes written report</span></span><strong>£95</strong></li>
          <li class="c-bordered c-rounded c-cluster rate-row"><span><strong>Emergency, out of hours</strong><br><span class="c-muted">Within four hours, any day</span></span><strong>£210</strong></li>
        </ul>
      </div>
    </section>`,
      css: `${listReset}.rate-row{padding:var(--space-md)}`,
    }),
  },
  {
    id: "pricing-billing-toggle",
    category: "pricing",
    name: "Monthly or yearly",
    description: "A real toggle between billing periods. The prices change on the page; nothing is charged.",
    kind: "pricing",
    interactive: true,
    build: (context) => ({
      html: `<section class="c-section" data-canvas-id="pricing" data-canvas-label="Pricing">
      <div class="c-container c-stack">
        <div class="c-stack"><h2>Pick a plan</h2><p class="c-muted">Yearly billing saves two months.</p></div>
        <div class="c-actions" role="group" aria-label="Billing period" data-canvas-id="pricing-period">
          <button type="button" class="c-button-secondary plan-period" data-period="monthly" aria-pressed="true">Monthly</button>
          <button type="button" class="c-button-secondary plan-period" data-period="yearly" aria-pressed="false">Yearly</button>
        </div>
        <div class="c-grid" aria-live="polite" data-canvas-id="pricing-plans">
          <article class="c-card c-stack plan-card" data-monthly="29" data-yearly="290">
            <h3>Starter</h3>
            <p><strong class="plan-amount">£29</strong> <span class="c-muted plan-period-label">per month</span></p>
            <p class="c-muted">For one person getting going.</p>
            <a class="c-button-secondary" href="${cta(context)}">Choose Starter</a>
          </article>
          <article class="c-card c-stack plan-card" data-monthly="79" data-yearly="790">
            <h3>Standard</h3>
            <p><strong class="plan-amount">£79</strong> <span class="c-muted plan-period-label">per month</span></p>
            <p class="c-muted">For a small team with real volume.</p>
            <a class="c-button-secondary" href="${cta(context)}">Choose Standard</a>
          </article>
          <article class="c-card c-stack plan-card" data-monthly="149" data-yearly="1490">
            <h3>Complete</h3>
            <p><strong class="plan-amount">£149</strong> <span class="c-muted plan-period-label">per month</span></p>
            <p class="c-muted">For everyone who needs a named contact.</p>
            <a class="c-button-secondary" href="${cta(context)}">Choose Complete</a>
          </article>
        </div>
      </div>
    </section>`,
      css: `${listReset}.plan-period[aria-pressed="true"]{border-color:var(--color-accent);color:var(--color-accent)}`,
      // The prices live on the cards as data attributes, so switching period is a text
      // change rather than a rebuilt grid — the live region announces one update.
      js: `var buttons = document.querySelectorAll(".plan-period");
var cards = document.querySelectorAll(".plan-card");
function apply(period) {
  for (var b = 0; b < buttons.length; b += 1) {
    buttons[b].setAttribute("aria-pressed", buttons[b].getAttribute("data-period") === period ? "true" : "false");
  }
  for (var c = 0; c < cards.length; c += 1) {
    var amount = cards[c].querySelector(".plan-amount");
    var label = cards[c].querySelector(".plan-period-label");
    if (amount) amount.textContent = "£" + cards[c].getAttribute(period === "yearly" ? "data-yearly" : "data-monthly");
    if (label) label.textContent = period === "yearly" ? "per year" : "per month";
  }
}
for (var index = 0; index < buttons.length; index += 1) {
  buttons[index].addEventListener("click", function (event) {
    apply(event.currentTarget.getAttribute("data-period"));
  });
}`,
    }),
  },
  {
    id: "pricing-quote-led",
    category: "pricing",
    name: "Quote led",
    description: "No numbers at all — what a quote covers and how to get one. For bespoke work priced honestly.",
    kind: "pricing",
    interactive: false,
    build: (context) => ({
      html: `<section class="c-section c-surface" data-canvas-id="pricing" data-canvas-label="Pricing">
      <div class="c-container">
        <div class="c-grid">
          <div class="c-stack" data-canvas-id="pricing-explainer">
            <p class="c-kicker">Pricing</p>
            <h2>Every job is quoted before it starts</h2>
            <p class="c-muted">We do not publish a price list because no two projects here are the same. What we do publish is exactly what a quote includes.</p>
            <div class="c-actions"><a class="c-button" href="${cta(context)}">Request a quote</a></div>
          </div>
          <div class="c-card c-stack" data-canvas-id="pricing-includes">
            <h3>What a quote covers</h3>
            <ul class="c-stack plan-list">
              <li>A site visit or a call, at no charge</li>
              <li>A fixed written price, valid for 30 days</li>
              <li>A start date and a finish date</li>
              <li>What happens if something unexpected turns up</li>
            </ul>
          </div>
        </div>
      </div>
    </section>`,
      css: listReset,
    }),
  },
];
