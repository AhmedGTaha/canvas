import { cta, type StarterSection } from "./types";

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
    build: (context) => `export default function Pricing() {
  return (
    <section className="c-section" data-canvas-id="pricing" data-canvas-label="Pricing">
      <div className="c-container c-stack">
        <div className="c-stack"><p className="c-kicker">Pricing</p><h2>Three ways to work with us</h2><p className="c-muted">Replace these plans and prices with your own.</p></div>
        <div className="c-grid">
          <article className="c-card c-stack" data-canvas-id="pricing-starter">
            <h3>Starter</h3>
            <p><strong>£29</strong> <span className="c-muted">per month</span></p>
            <ul className="c-stack"><li>The first thing included</li><li>The second thing included</li><li>The third thing included</li></ul>
            <a className="c-button-secondary" href="${cta(context)}">Choose Starter</a>
          </article>
          <article className="c-card c-shadow c-stack" data-canvas-id="pricing-standard">
            <p className="c-kicker">Most chosen</p>
            <h3>Standard</h3>
            <p><strong>£79</strong> <span className="c-muted">per month</span></p>
            <ul className="c-stack"><li>Everything in Starter</li><li>The thing that makes this the popular one</li><li>Priority support</li></ul>
            <a className="c-button" href="${cta(context)}">Choose Standard</a>
          </article>
          <article className="c-card c-stack" data-canvas-id="pricing-complete">
            <h3>Complete</h3>
            <p><strong>£149</strong> <span className="c-muted">per month</span></p>
            <ul className="c-stack"><li>Everything in Standard</li><li>The thing larger customers need</li><li>A named contact</li></ul>
            <a className="c-button-secondary" href="${cta(context)}">Choose Complete</a>
          </article>
        </div>
      </div>
    </section>
  );
}
`,
  },
  {
    id: "pricing-two-tier",
    category: "pricing",
    name: "Two tiers",
    description: "One plan and one 'talk to us'. Honest when the second half of the market is bespoke.",
    kind: "pricing",
    interactive: false,
    build: (context) => `export default function Pricing() {
  return (
    <section className="c-section c-surface" data-canvas-id="pricing" data-canvas-label="Pricing">
      <div className="c-container c-stack">
        <h2>Simple, and then bespoke</h2>
        <div className="c-grid">
          <article className="c-card c-stack" data-canvas-id="pricing-standard">
            <h3>Standard</h3>
            <p><strong>£79</strong> <span className="c-muted">per month, billed monthly</span></p>
            <p className="c-muted">Everything most customers need, with nothing to configure.</p>
            <ul className="c-stack"><li>The first thing included</li><li>The second thing included</li><li>The third thing included</li></ul>
            <a className="c-button" href="${cta(context)}">Get started</a>
          </article>
          <article className="c-card c-stack" data-canvas-id="pricing-bespoke">
            <h3>Bespoke</h3>
            <p><strong>Priced per project</strong></p>
            <p className="c-muted">For work with its own shape. We scope it, quote it, then build it.</p>
            <ul className="c-stack"><li>A scoping session</li><li>A fixed written quote</li><li>A named contact throughout</li></ul>
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
    id: "pricing-rate-card",
    category: "pricing",
    name: "Rate card",
    description: "A flat list of jobs and prices. For trades and services priced per task, not per month.",
    kind: "pricing",
    interactive: false,
    build: () => `export default function RateCard() {
  return (
    <section className="c-section" data-canvas-id="pricing" data-canvas-label="Pricing">
      <div className="c-container c-stack">
        <div className="c-stack"><h2>What things cost</h2><p className="c-muted">Prices include labour and VAT. Anything unusual is quoted before work starts.</p></div>
        <ul className="c-stack" data-canvas-id="pricing-rates">
          <li className="c-bordered c-rounded c-cluster"><span><strong>Call-out and diagnosis</strong><br /><span className="c-muted">Waived if we do the work</span></span><strong>£65</strong></li>
          <li className="c-bordered c-rounded c-cluster"><span><strong>Standard repair</strong><br /><span className="c-muted">Up to two hours on site</span></span><strong>£140</strong></li>
          <li className="c-bordered c-rounded c-cluster"><span><strong>Annual service</strong><br /><span className="c-muted">Includes written report</span></span><strong>£95</strong></li>
          <li className="c-bordered c-rounded c-cluster"><span><strong>Emergency, out of hours</strong><br /><span className="c-muted">Within four hours, any day</span></span><strong>£210</strong></li>
        </ul>
      </div>
    </section>
  );
}
`,
  },
  {
    id: "pricing-billing-toggle",
    category: "pricing",
    name: "Monthly or yearly",
    description: "A real toggle between billing periods. The prices change on the page; nothing is charged.",
    kind: "pricing",
    interactive: true,
    build: (context) => `"use client";
import { useState } from "react";

const PLANS = [
  { id: "starter", name: "Starter", monthly: 29, yearly: 290, line: "For one person getting going." },
  { id: "standard", name: "Standard", monthly: 79, yearly: 790, line: "For a small team with real volume." },
  { id: "complete", name: "Complete", monthly: 149, yearly: 1490, line: "For everyone who needs a named contact." },
];

export default function PricingToggle() {
  const [yearly, setYearly] = useState(false);
  return (
    <section className="c-section" data-canvas-id="pricing" data-canvas-label="Pricing">
      <div className="c-container c-stack">
        <div className="c-stack"><h2>Pick a plan</h2><p className="c-muted">Yearly billing saves two months.</p></div>
        <div className="c-actions" role="group" aria-label="Billing period" data-canvas-id="pricing-period">
          <button type="button" className="c-button-secondary" aria-pressed={!yearly} onClick={() => setYearly(false)}>Monthly</button>
          <button type="button" className="c-button-secondary" aria-pressed={yearly} onClick={() => setYearly(true)}>Yearly</button>
        </div>
        <div className="c-grid" aria-live="polite" data-canvas-id="pricing-plans">
          {PLANS.map((plan) => (
            <article key={plan.id} className="c-card c-stack">
              <h3>{plan.name}</h3>
              <p><strong>{"£" + (yearly ? plan.yearly : plan.monthly)}</strong> <span className="c-muted">{yearly ? "per year" : "per month"}</span></p>
              <p className="c-muted">{plan.line}</p>
              <a className="c-button-secondary" href="${cta(context)}">Choose {plan.name}</a>
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
    id: "pricing-quote-led",
    category: "pricing",
    name: "Quote led",
    description: "No numbers at all — what a quote covers and how to get one. For bespoke work priced honestly.",
    kind: "pricing",
    interactive: false,
    build: (context) => `export default function QuoteLedPricing() {
  return (
    <section className="c-section c-surface" data-canvas-id="pricing" data-canvas-label="Pricing">
      <div className="c-container">
        <div className="c-grid">
          <div className="c-stack" data-canvas-id="pricing-explainer">
            <p className="c-kicker">Pricing</p>
            <h2>Every job is quoted before it starts</h2>
            <p className="c-muted">We do not publish a price list because no two projects here are the same. What we do publish is exactly what a quote includes.</p>
            <div className="c-actions"><a className="c-button" href="${cta(context)}">Request a quote</a></div>
          </div>
          <div className="c-card c-stack" data-canvas-id="pricing-includes">
            <h3>What a quote covers</h3>
            <ul className="c-stack">
              <li>A site visit or a call, at no charge</li>
              <li>A fixed written price, valid for 30 days</li>
              <li>A start date and a finish date</li>
              <li>What happens if something unexpected turns up</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
`,
  },
];
