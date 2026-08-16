import { cta, text, type StarterSection } from "./types";

/**
 * Five heroes that differ in what carries the page: a claim, a split with proof, a
 * measured stat row, a guided entry point, and an announcement-led launch hero.
 */
export const HERO_STARTERS: StarterSection[] = [
  {
    id: "hero-statement",
    category: "hero",
    name: "Single claim",
    description: "One headline, one supporting line, one action. The most confident hero there is.",
    kind: "hero",
    interactive: false,
    build: (context) => ({
      html: `<section class="c-section c-hero" data-canvas-id="hero" data-canvas-label="Hero">
      <div class="c-container c-stack">
        <p class="c-kicker">${text(context.companyName)}</p>
        <h1>Replace this with one specific claim about what you do</h1>
        <p class="c-muted">One supporting sentence naming who it is for and what changes for them.</p>
        <div class="c-actions">
          <a class="c-button" href="${cta(context)}">Start here</a>
          <a class="c-link" href="${cta(context)}">See how it works</a>
        </div>
      </div>
    </section>`,
    }),
  },
  {
    id: "hero-split-proof",
    category: "hero",
    name: "Split with proof",
    description: "Claim on one side, a bordered proof panel on the other. Good when credibility is the hurdle.",
    kind: "hero",
    interactive: false,
    build: (context) => ({
      html: `<section class="c-section c-hero" data-canvas-id="hero" data-canvas-label="Hero">
      <div class="c-container">
        <div class="c-grid">
          <div class="c-stack" data-canvas-id="hero-claim">
            <p class="c-kicker">Since 2011</p>
            <h1>A headline that names the outcome, not the category</h1>
            <p class="c-muted">Two sentences at most. Say what you do, who for, and how quickly.</p>
            <div class="c-actions"><a class="c-button" href="${cta(context)}">Request a quote</a></div>
          </div>
          <div class="c-card c-stack" data-canvas-id="hero-proof">
            <h2>Why people choose us</h2>
            <ul class="c-stack">
              <li>Fixed quotes, agreed before any work starts</li>
              <li>Fully insured crews, on site within 24 hours</li>
              <li>Two-year workmanship guarantee in writing</li>
            </ul>
          </div>
        </div>
      </div>
    </section>`,
    }),
  },
  {
    id: "hero-stat-band",
    category: "hero",
    name: "Claim over stats",
    description: "A centred claim above a tight row of figures. Denser than a plain hero, and earns the space.",
    kind: "hero",
    interactive: false,
    build: (context) => ({
      html: `<section class="c-section c-hero" data-canvas-id="hero" data-canvas-label="Hero">
      <div class="c-container c-stack">
        <div class="c-stack" data-canvas-id="hero-claim">
          <h1>The claim your best customer would repeat to a friend</h1>
          <p class="c-muted">One line of support. Keep it concrete.</p>
          <div class="c-actions"><a class="c-button" href="${cta(context)}">Get started</a><a class="c-button-secondary" href="${cta(context)}">Talk to us</a></div>
        </div>
        <div class="c-row hero-stats" data-canvas-id="hero-stats">
          <div class="c-stack"><h2>1,400+</h2><p class="c-muted">Projects delivered</p></div>
          <div class="c-stack"><h2>24h</h2><p class="c-muted">Typical response</p></div>
          <div class="c-stack"><h2>12 yrs</h2><p class="c-muted">In business</p></div>
        </div>
      </div>
    </section>`,
      css: `.hero-stats{gap:var(--space-xl);padding-top:var(--space-lg);border-top:var(--border-width) solid var(--color-border)}.hero-stats h2{margin:0}.hero-stats p{margin:0}`,
    }),
  },
  {
    id: "hero-entry-search",
    category: "hero",
    name: "Guided entry",
    description: "A hero that starts a task rather than describing one. The field filters locally; nothing is submitted.",
    kind: "hero",
    interactive: true,
    build: (context) => ({
      html: `<section class="c-section c-hero" data-canvas-id="hero" data-canvas-label="Hero">
      <div class="c-container c-stack">
        <h1>Tell us what you need and we will price it today</h1>
        <p class="c-muted">Start typing to find the service you are after. This filters the list on the page and does not send anything.</p>
        <label class="c-stack" for="hero-search">
          <span class="c-muted">What do you need?</span>
          <input id="hero-search" type="text" placeholder="Emergency repair" autocomplete="off">
        </label>
        <ul class="c-stack hero-matches" aria-live="polite" data-canvas-id="hero-matches">
          <li><a class="c-link" href="${cta(context)}">Emergency repair</a></li>
          <li><a class="c-link" href="${cta(context)}">Planned maintenance</a></li>
          <li><a class="c-link" href="${cta(context)}">New installation</a></li>
          <li><a class="c-link" href="${cta(context)}">Inspection and report</a></li>
          <li class="c-muted hero-empty" hidden>Nothing matches that yet — call us and we will help.</li>
        </ul>
      </div>
    </section>`,
      css: `.hero-matches{list-style:none;margin:0;padding:0}`,
      // Filtering hides list items rather than removing them, so the ids stay stable and
      // the aria-live region announces one change instead of a rebuilt list.
      js: `var field = document.getElementById("hero-search");
var list = document.querySelector(".hero-matches");
if (field && list) {
  var empty = list.querySelector(".hero-empty");
  var options = list.querySelectorAll("li a");
  field.addEventListener("input", function () {
    var query = field.value.trim().toLowerCase();
    var shown = 0;
    for (var index = 0; index < options.length; index += 1) {
      var item = options[index].parentNode;
      var matches = options[index].textContent.toLowerCase().indexOf(query) !== -1;
      if (matches) { item.removeAttribute("hidden"); shown += 1; } else { item.setAttribute("hidden", ""); }
    }
    if (empty) { if (shown === 0) empty.removeAttribute("hidden"); else empty.setAttribute("hidden", ""); }
  });
}`,
    }),
  },
  {
    id: "hero-announcement",
    category: "hero",
    name: "Announcement led",
    description: "A dated notice above the claim. For openings, launches, seasonal menus and campaigns.",
    kind: "hero",
    interactive: false,
    build: (context) => ({
      html: `<section class="c-section c-hero c-surface" data-canvas-id="hero" data-canvas-label="Hero">
      <div class="c-container c-stack">
        <div class="c-card c-stack" data-canvas-id="hero-announcement">
          <p class="c-kicker">New this season</p>
          <p>Replace this with the thing you want people to know first.</p>
        </div>
        <h1>${text(context.companyName)}, in one honest sentence</h1>
        <p class="c-muted">One line of support, then get out of the way.</p>
        <div class="c-actions"><a class="c-button" href="${cta(context)}">See what is on</a></div>
      </div>
    </section>`,
    }),
  },
];
