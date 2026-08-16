import type { StarterSection } from "./types";

/**
 * Five testimonial sections. Quotes are unattributed placeholders on purpose: inventing
 * a named customer is the one thing a starter template must never do.
 */
export const TESTIMONIAL_STARTERS: StarterSection[] = [
  {
    id: "testimonial-single",
    category: "testimonial",
    name: "One large quote",
    description: "A single quote given the whole section. Strongest when you have one very good one.",
    kind: "testimonial",
    interactive: false,
    build: () => `export default function Testimonial() {
  return (
    <section className="c-section c-surface" data-canvas-id="testimonial" data-canvas-label="Testimonial">
      <div className="c-container c-stack">
        <figure className="c-stack" data-canvas-id="testimonial-quote">
          <blockquote>
            <h2>Replace this with something a real customer actually said about working with you.</h2>
          </blockquote>
          <figcaption className="c-muted">Add the person&apos;s name and role once you have their permission.</figcaption>
        </figure>
      </div>
    </section>
  );
}
`,
  },
  {
    id: "testimonial-three-up",
    category: "testimonial",
    name: "Three quotes",
    description: "A peer row of short quotes. Reads as breadth rather than depth.",
    kind: "testimonial",
    interactive: false,
    build: () => `export default function Testimonials() {
  return (
    <section className="c-section" data-canvas-id="testimonials" data-canvas-label="Testimonials">
      <div className="c-container c-stack">
        <div className="c-stack"><p className="c-kicker">In their words</p><h2>What people say afterwards</h2></div>
        <div className="c-grid">
          <figure className="c-card c-stack" data-canvas-id="testimonial-1">
            <blockquote><p>A short quote, one or two sentences, in the customer&apos;s own words.</p></blockquote>
            <figcaption className="c-muted">Name, role — once you have permission</figcaption>
          </figure>
          <figure className="c-card c-stack" data-canvas-id="testimonial-2">
            <blockquote><p>A short quote, one or two sentences, in the customer&apos;s own words.</p></blockquote>
            <figcaption className="c-muted">Name, role — once you have permission</figcaption>
          </figure>
          <figure className="c-card c-stack" data-canvas-id="testimonial-3">
            <blockquote><p>A short quote, one or two sentences, in the customer&apos;s own words.</p></blockquote>
            <figcaption className="c-muted">Name, role — once you have permission</figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}
`,
  },
  {
    id: "testimonial-carousel",
    category: "testimonial",
    name: "Stepped quotes",
    description: "One quote at a time with previous and next controls. Keyboard operable, no auto-advance.",
    kind: "testimonial",
    interactive: true,
    build: () => `"use client";
import { useState } from "react";

const QUOTES = [
  { id: "one", quote: "Replace each of these with something a customer actually said.", who: "Name, role" },
  { id: "two", quote: "Keep them short enough to read in one breath.", who: "Name, role" },
  { id: "three", quote: "Three or four is plenty; more and nobody steps through them.", who: "Name, role" },
];

export default function TestimonialCarousel() {
  const [index, setIndex] = useState(0);
  const current = QUOTES[index];
  return (
    <section className="c-section c-surface" data-canvas-id="testimonials" data-canvas-label="Testimonials">
      <div className="c-container c-stack">
        <h2>What people say</h2>
        <figure className="c-card c-stack" aria-live="polite" data-canvas-id="testimonial-current">
          <blockquote><p>{current.quote}</p></blockquote>
          <figcaption className="c-muted">{current.who}</figcaption>
        </figure>
        <div className="c-actions" data-canvas-id="testimonial-controls">
          <button type="button" className="c-button-secondary" onClick={() => setIndex((index + QUOTES.length - 1) % QUOTES.length)}>Previous</button>
          <p className="c-muted">{index + 1} of {QUOTES.length}</p>
          <button type="button" className="c-button-secondary" onClick={() => setIndex((index + 1) % QUOTES.length)}>Next</button>
        </div>
      </div>
    </section>
  );
}
`,
  },
  {
    id: "testimonial-with-results",
    category: "testimonial",
    name: "Quote with results",
    description: "A quote beside the numbers it refers to. For work whose value can be counted.",
    kind: "testimonial",
    interactive: false,
    build: () => `export default function TestimonialResults() {
  return (
    <section className="c-section" data-canvas-id="testimonial" data-canvas-label="Testimonial">
      <div className="c-container">
        <div className="c-grid">
          <figure className="c-stack" data-canvas-id="testimonial-quote">
            <blockquote><h2>A quote that names the problem you solved, not how nice you were.</h2></blockquote>
            <figcaption className="c-muted">Name, role — once you have permission</figcaption>
          </figure>
          <div className="c-card c-stack" data-canvas-id="testimonial-results">
            <h3>What changed</h3>
            <dl className="c-stack">
              <div className="c-cluster"><dt className="c-muted">Before</dt><dd>Replace with a real figure</dd></div>
              <div className="c-cluster"><dt className="c-muted">After</dt><dd>Replace with a real figure</dd></div>
              <div className="c-cluster"><dt className="c-muted">Time taken</dt><dd>Replace with a real figure</dd></div>
            </dl>
            <p className="c-muted">Only publish numbers you can evidence.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
`,
  },
  {
    id: "testimonial-logo-wall",
    category: "testimonial",
    name: "Names and a quote",
    description: "A line of client names above one quote. Social proof without needing five stories.",
    kind: "testimonial",
    interactive: false,
    build: () => `export default function TestimonialWall() {
  return (
    <section className="c-section c-surface" data-canvas-id="testimonials" data-canvas-label="Testimonials">
      <div className="c-container c-stack">
        <p className="c-kicker">Trusted by</p>
        <ul className="c-row" data-canvas-id="testimonial-names">
          <li><strong>First client</strong></li>
          <li><strong>Second client</strong></li>
          <li><strong>Third client</strong></li>
          <li><strong>Fourth client</strong></li>
          <li><strong>Fifth client</strong></li>
        </ul>
        <figure className="c-card c-stack" data-canvas-id="testimonial-quote">
          <blockquote><p>One quote from the client you would most like to be known for.</p></blockquote>
          <figcaption className="c-muted">Name, role — once you have permission</figcaption>
        </figure>
      </div>
    </section>
  );
}
`,
  },
];
