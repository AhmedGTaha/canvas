import { cta, type StarterSection } from "./types";

const listReset = `.service-list{list-style:none;margin:0;padding:0}.step-list{list-style:none;margin:0;padding:0}`;

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
    build: (context) => ({
      html: `<section class="c-section" data-canvas-id="services" data-canvas-label="Services">
      <div class="c-container c-stack">
        <div class="c-stack"><p class="c-kicker">What we do</p><h2>Three things we are genuinely good at</h2><p class="c-muted">Replace each card with a service you actually sell.</p></div>
        <div class="c-grid">
          <article class="c-card c-stack" data-canvas-id="service-1"><h3>First service</h3><p class="c-muted">Two sentences. What it is, and what someone gets at the end of it.</p><a class="c-link" href="${cta(context)}">More about this</a></article>
          <article class="c-card c-stack" data-canvas-id="service-2"><h3>Second service</h3><p class="c-muted">Two sentences. What it is, and what someone gets at the end of it.</p><a class="c-link" href="${cta(context)}">More about this</a></article>
          <article class="c-card c-stack" data-canvas-id="service-3"><h3>Third service</h3><p class="c-muted">Two sentences. What it is, and what someone gets at the end of it.</p><a class="c-link" href="${cta(context)}">More about this</a></article>
        </div>
      </div>
    </section>`,
    }),
  },
  {
    id: "services-process",
    category: "services",
    name: "Numbered process",
    description: "Four ordered steps. For work where the worry is 'what actually happens'.",
    kind: "section",
    interactive: false,
    build: () => ({
      html: `<section class="c-section c-surface" data-canvas-id="process" data-canvas-label="How it works">
      <div class="c-container c-stack">
        <div class="c-stack"><p class="c-kicker">How it works</p><h2>Four steps, start to finish</h2></div>
        <ol class="c-grid step-list" data-canvas-id="process-steps">
          <li class="c-card c-stack"><p class="c-kicker">Step one</p><h3>You get in touch</h3><p class="c-muted">Say what you need. We reply the same working day.</p></li>
          <li class="c-card c-stack"><p class="c-kicker">Step two</p><h3>We take a look</h3><p class="c-muted">A visit or a call, at no charge, so the quote is real.</p></li>
          <li class="c-card c-stack"><p class="c-kicker">Step three</p><h3>You get a fixed price</h3><p class="c-muted">In writing, with dates, valid for 30 days.</p></li>
          <li class="c-card c-stack"><p class="c-kicker">Step four</p><h3>We do the work</h3><p class="c-muted">On the agreed dates, cleared up afterwards.</p></li>
        </ol>
      </div>
    </section>`,
      css: listReset,
    }),
  },
  {
    id: "services-alternating",
    category: "services",
    name: "Alternating detail",
    description: "Two-column rows, one service at a time, with room for a real explanation.",
    kind: "section",
    interactive: false,
    build: (context) => ({
      html: `<section class="c-section" data-canvas-id="services" data-canvas-label="Services">
      <div class="c-container c-stack">
        <div class="c-grid" data-canvas-id="service-detail-1">
          <div class="c-stack"><p class="c-kicker">Service one</p><h2>Given enough room to explain itself</h2><p class="c-muted">Three or four sentences. What the work involves, who it suits, what it costs roughly, and how long it takes.</p><div class="c-actions"><a class="c-button-secondary" href="${cta(context)}">Ask about this</a></div></div>
          <div class="c-card c-stack"><h3>Included</h3><ul class="c-stack service-list"><li>The first thing included</li><li>The second thing included</li><li>The third thing included</li></ul></div>
        </div>
        <div class="c-grid" data-canvas-id="service-detail-2">
          <div class="c-card c-stack"><h3>Included</h3><ul class="c-stack service-list"><li>The first thing included</li><li>The second thing included</li><li>The third thing included</li></ul></div>
          <div class="c-stack"><p class="c-kicker">Service two</p><h2>The second one, with the sides swapped</h2><p class="c-muted">Alternating the panel side is what stops a long page of services reading as one long list.</p><div class="c-actions"><a class="c-button-secondary" href="${cta(context)}">Ask about this</a></div></div>
        </div>
      </div>
    </section>`,
      css: listReset,
    }),
  },
  {
    id: "services-tabs",
    category: "services",
    name: "By audience",
    description: "Tabs for different kinds of customer. Real tab semantics, keyboard reachable.",
    kind: "section",
    interactive: true,
    build: () => ({
      html: `<section class="c-section" data-canvas-id="services" data-canvas-label="Services">
      <div class="c-container c-stack">
        <div class="c-stack"><p class="c-kicker">What we do</p><h2>Different work for different customers</h2></div>
        <div class="c-row" role="tablist" aria-label="Who you are" data-canvas-id="services-tabs">
          <button type="button" role="tab" id="services-tab-home" class="c-button-secondary services-tab" aria-selected="true" aria-controls="services-panel-home">Homeowners</button>
          <button type="button" role="tab" id="services-tab-trade" class="c-button-secondary services-tab" aria-selected="false" aria-controls="services-panel-trade">Trade</button>
          <button type="button" role="tab" id="services-tab-commercial" class="c-button-secondary services-tab" aria-selected="false" aria-controls="services-panel-commercial">Commercial</button>
        </div>
        <div class="c-card c-stack services-panel" role="tabpanel" id="services-panel-home" aria-labelledby="services-tab-home" data-canvas-id="services-panel">
          <h3>For homes</h3>
          <p class="c-muted">What you do for households, in two or three sentences.</p>
          <ul class="c-stack service-list"><li>Fixed prices</li><li>Evening appointments</li><li>Two-year guarantee</li></ul>
        </div>
        <div class="c-card c-stack services-panel" role="tabpanel" id="services-panel-trade" aria-labelledby="services-tab-trade" hidden>
          <h3>For trade</h3>
          <p class="c-muted">What you do for other trades, in two or three sentences.</p>
          <ul class="c-stack service-list"><li>Account terms</li><li>Priority slots</li><li>Bulk pricing</li></ul>
        </div>
        <div class="c-card c-stack services-panel" role="tabpanel" id="services-panel-commercial" aria-labelledby="services-tab-commercial" hidden>
          <h3>For commercial sites</h3>
          <p class="c-muted">What you do for businesses, in two or three sentences.</p>
          <ul class="c-stack service-list"><li>Out-of-hours work</li><li>Compliance reporting</li><li>Named contact</li></ul>
        </div>
      </div>
    </section>`,
      css: `${listReset}.services-tab[aria-selected="true"]{border-color:var(--color-accent);color:var(--color-accent)}`,
      js: `var tabs = document.querySelectorAll(".services-tab");
for (var index = 0; index < tabs.length; index += 1) {
  tabs[index].addEventListener("click", function (event) {
    var chosen = event.currentTarget;
    for (var other = 0; other < tabs.length; other += 1) {
      var panel = document.getElementById(tabs[other].getAttribute("aria-controls"));
      var active = tabs[other] === chosen;
      tabs[other].setAttribute("aria-selected", active ? "true" : "false");
      if (panel) { if (active) panel.removeAttribute("hidden"); else panel.setAttribute("hidden", ""); }
    }
  });
}`,
    }),
  },
  {
    id: "services-scope",
    category: "services",
    name: "In scope, out of scope",
    description: "Two honest columns: what you do and what you do not. Saves everyone a phone call.",
    kind: "section",
    interactive: false,
    build: () => ({
      html: `<section class="c-section c-surface" data-canvas-id="services" data-canvas-label="Services">
      <div class="c-container c-stack">
        <div class="c-stack"><p class="c-kicker">Scope</p><h2>What we take on, and what we do not</h2><p class="c-muted">Being clear about the second half is what makes the first half believable.</p></div>
        <div class="c-grid">
          <div class="c-card c-stack" data-canvas-id="services-in-scope">
            <h3>We do this</h3>
            <ul class="c-stack service-list"><li>The first thing you do</li><li>The second thing you do</li><li>The third thing you do</li><li>The fourth thing you do</li></ul>
          </div>
          <div class="c-card c-stack" data-canvas-id="services-out-of-scope">
            <h3>We do not do this</h3>
            <ul class="c-stack service-list"><li>The first thing you refer on</li><li>The second thing you refer on</li><li>The third thing you refer on</li></ul>
            <p class="c-muted">We will happily point you at someone who does.</p>
          </div>
        </div>
      </div>
    </section>`,
      css: listReset,
    }),
  },
];
