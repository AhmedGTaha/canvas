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
    build: () => ({
      html: `<section class="c-section c-surface" data-canvas-id="testimonial" data-canvas-label="Testimonial">
      <div class="c-container c-stack">
        <figure class="c-stack quote-feature" data-canvas-id="testimonial-quote">
          <blockquote>
            <h2>Replace this with something a real customer actually said about working with you.</h2>
          </blockquote>
          <figcaption class="c-muted">Add the person&rsquo;s name and role once you have their permission.</figcaption>
        </figure>
      </div>
    </section>`,
      css: `.quote-feature{margin:0}.quote-feature blockquote{margin:0}.quote-feature h2{margin:0}`,
    }),
  },
  {
    id: "testimonial-three-up",
    category: "testimonial",
    name: "Three quotes",
    description: "A peer row of short quotes. Reads as breadth rather than depth.",
    kind: "testimonial",
    interactive: false,
    build: () => ({
      html: `<section class="c-section" data-canvas-id="testimonials" data-canvas-label="Testimonials">
      <div class="c-container c-stack">
        <div class="c-stack"><p class="c-kicker">In their words</p><h2>What people say afterwards</h2></div>
        <div class="c-grid">
          <figure class="c-card c-stack quote-card" data-canvas-id="testimonial-1">
            <blockquote><p>A short quote, one or two sentences, in the customer&rsquo;s own words.</p></blockquote>
            <figcaption class="c-muted">Name, role — once you have permission</figcaption>
          </figure>
          <figure class="c-card c-stack quote-card" data-canvas-id="testimonial-2">
            <blockquote><p>A short quote, one or two sentences, in the customer&rsquo;s own words.</p></blockquote>
            <figcaption class="c-muted">Name, role — once you have permission</figcaption>
          </figure>
          <figure class="c-card c-stack quote-card" data-canvas-id="testimonial-3">
            <blockquote><p>A short quote, one or two sentences, in the customer&rsquo;s own words.</p></blockquote>
            <figcaption class="c-muted">Name, role — once you have permission</figcaption>
          </figure>
        </div>
      </div>
    </section>`,
      css: `.quote-card{margin:0}.quote-card blockquote{margin:0}.quote-card blockquote p{margin:0}`,
    }),
  },
  {
    id: "testimonial-carousel",
    category: "testimonial",
    name: "Stepped quotes",
    description: "One quote at a time with previous and next controls. Keyboard operable, no auto-advance.",
    kind: "testimonial",
    interactive: true,
    build: () => ({
      html: `<section class="c-section c-surface" data-canvas-id="testimonials" data-canvas-label="Testimonials">
      <div class="c-container c-stack">
        <h2>What people say</h2>
        <div class="quote-deck" aria-live="polite" data-canvas-id="testimonial-current">
          <figure class="c-card c-stack quote-slide"><blockquote><p>Replace each of these with something a customer actually said.</p></blockquote><figcaption class="c-muted">Name, role</figcaption></figure>
          <figure class="c-card c-stack quote-slide" hidden><blockquote><p>Keep them short enough to read in one breath.</p></blockquote><figcaption class="c-muted">Name, role</figcaption></figure>
          <figure class="c-card c-stack quote-slide" hidden><blockquote><p>Three or four is plenty; more and nobody steps through them.</p></blockquote><figcaption class="c-muted">Name, role</figcaption></figure>
        </div>
        <div class="c-actions" data-canvas-id="testimonial-controls">
          <button type="button" class="c-button-secondary quote-previous">Previous</button>
          <p class="c-muted quote-position">1 of 3</p>
          <button type="button" class="c-button-secondary quote-next">Next</button>
        </div>
      </div>
    </section>`,
      css: `.quote-slide{margin:0}.quote-slide blockquote{margin:0}.quote-slide blockquote p{margin:0}`,
      // Every quote stays in the document and visibility moves between them, so the ids
      // are stable and the live region announces one change per step.
      js: `var slides = document.querySelectorAll(".quote-slide");
var position = document.querySelector(".quote-position");
var previous = document.querySelector(".quote-previous");
var next = document.querySelector(".quote-next");
var index = 0;
function show(target) {
  index = (target + slides.length) % slides.length;
  for (var i = 0; i < slides.length; i += 1) {
    if (i === index) slides[i].removeAttribute("hidden"); else slides[i].setAttribute("hidden", "");
  }
  if (position) position.textContent = (index + 1) + " of " + slides.length;
}
if (previous) previous.addEventListener("click", function () { show(index - 1); });
if (next) next.addEventListener("click", function () { show(index + 1); });`,
    }),
  },
  {
    id: "testimonial-with-results",
    category: "testimonial",
    name: "Quote with results",
    description: "A quote beside the numbers it refers to. For work whose value can be counted.",
    kind: "testimonial",
    interactive: false,
    build: () => ({
      html: `<section class="c-section" data-canvas-id="testimonial" data-canvas-label="Testimonial">
      <div class="c-container">
        <div class="c-grid">
          <figure class="c-stack quote-feature" data-canvas-id="testimonial-quote">
            <blockquote><h2>A quote that names the problem you solved, not how nice you were.</h2></blockquote>
            <figcaption class="c-muted">Name, role — once you have permission</figcaption>
          </figure>
          <div class="c-card c-stack" data-canvas-id="testimonial-results">
            <h3>What changed</h3>
            <dl class="c-stack result-list">
              <div class="c-cluster"><dt class="c-muted">Before</dt><dd>Replace with a real figure</dd></div>
              <div class="c-cluster"><dt class="c-muted">After</dt><dd>Replace with a real figure</dd></div>
              <div class="c-cluster"><dt class="c-muted">Time taken</dt><dd>Replace with a real figure</dd></div>
            </dl>
            <p class="c-muted">Only publish numbers you can evidence.</p>
          </div>
        </div>
      </div>
    </section>`,
      css: `.quote-feature{margin:0}.quote-feature blockquote{margin:0}.quote-feature h2{margin:0}.result-list{margin:0}.result-list dd{margin:0}`,
    }),
  },
  {
    id: "testimonial-logo-wall",
    category: "testimonial",
    name: "Names and a quote",
    description: "A line of client names above one quote. Social proof without needing five stories.",
    kind: "testimonial",
    interactive: false,
    build: () => ({
      html: `<section class="c-section c-surface" data-canvas-id="testimonials" data-canvas-label="Testimonials">
      <div class="c-container c-stack">
        <p class="c-kicker">Trusted by</p>
        <ul class="c-row name-wall" data-canvas-id="testimonial-names">
          <li><strong>First client</strong></li>
          <li><strong>Second client</strong></li>
          <li><strong>Third client</strong></li>
          <li><strong>Fourth client</strong></li>
          <li><strong>Fifth client</strong></li>
        </ul>
        <figure class="c-card c-stack quote-card" data-canvas-id="testimonial-quote">
          <blockquote><p>One quote from the client you would most like to be known for.</p></blockquote>
          <figcaption class="c-muted">Name, role — once you have permission</figcaption>
        </figure>
      </div>
    </section>`,
      css: `.name-wall{list-style:none;margin:0;padding:0;gap:var(--space-xl)}.quote-card{margin:0}.quote-card blockquote{margin:0}.quote-card blockquote p{margin:0}`,
    }),
  },
];
