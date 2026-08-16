import { text, type StarterSection } from "./types";

/**
 * Five contact sections. Every form here is explicitly local: fields validate in the
 * browser and say so, and none of them claim to send anything, because a generated site
 * is frontend-only and pretending otherwise is the worst thing a contact section can do.
 */
export const CONTACT_STARTERS: StarterSection[] = [
  {
    id: "contact-details",
    category: "contact",
    name: "Details only",
    description: "Phone, email, address and hours. No form, nothing to mislead.",
    kind: "contact",
    interactive: false,
    build: (context) => ({
      html: `<section class="c-section" data-canvas-id="contact" data-canvas-label="Contact">
      <div class="c-container c-stack">
        <div class="c-stack"><p class="c-kicker">Contact</p><h2>How to reach ${text(context.companyName)}</h2></div>
        <div class="c-grid">
          <div class="c-stack" data-canvas-id="contact-phone"><h3>Phone</h3><p><a class="c-link" href="tel:+15550100">(555) 010-0</a></p><p class="c-muted">Monday to Friday, 8am–6pm</p></div>
          <div class="c-stack" data-canvas-id="contact-email"><h3>Email</h3><p><a class="c-link" href="mailto:hello@example.com">hello@example.com</a></p><p class="c-muted">We reply within one working day</p></div>
          <div class="c-stack" data-canvas-id="contact-address"><h3>Visit</h3><p>12 Market Street<br>Springfield</p><p class="c-muted">Parking behind the building</p></div>
        </div>
      </div>
    </section>`,
    }),
  },
  {
    id: "contact-form-split",
    category: "contact",
    name: "Form beside details",
    description: "A validating enquiry form on one side, real contact details on the other.",
    kind: "contact",
    interactive: true,
    build: () => ({
      html: `<section class="c-section" data-canvas-id="contact" data-canvas-label="Contact">
      <div class="c-container">
        <div class="c-grid">
          <form class="c-card c-stack enquiry-form" data-canvas-id="contact-form">
            <h2>Send us a message</h2>
            <p class="c-muted">This form checks what you type but does not send anything yet. Connect it to your own email service before launch.</p>
            <label class="c-stack" for="contact-name"><span>Your name</span><input id="contact-name" type="text" autocomplete="name"></label>
            <label class="c-stack" for="contact-email"><span>Email address</span><input id="contact-email" type="email" autocomplete="email"></label>
            <label class="c-stack" for="contact-message"><span>What can we help with?</span><textarea id="contact-message" rows="4"></textarea></label>
            <p class="c-muted enquiry-status" aria-live="polite">Ready to send once this form is connected.</p>
            <button type="button" class="c-button enquiry-submit" disabled>Send message</button>
          </form>
          <div class="c-stack" data-canvas-id="contact-details">
            <h2>Or reach us directly</h2>
            <p><a class="c-link" href="tel:+15550100">(555) 010-0</a></p>
            <p><a class="c-link" href="mailto:hello@example.com">hello@example.com</a></p>
            <p class="c-muted">12 Market Street, Springfield</p>
            <p class="c-muted">Monday to Friday, 8am–6pm</p>
          </div>
        </div>
      </div>
    </section>`,
      css: `.enquiry-form input,.enquiry-form textarea{width:100%;padding:var(--space-sm);border:var(--border-width) solid var(--color-border);border-radius:var(--radius-md);background:var(--color-background);color:var(--color-text);font:inherit}`,
      js: `var form = document.querySelector(".enquiry-form");
if (form) {
  var name = document.getElementById("contact-name");
  var email = document.getElementById("contact-email");
  var message = document.getElementById("contact-message");
  var status = form.querySelector(".enquiry-status");
  var submit = form.querySelector(".enquiry-submit");
  function check() {
    var problems = [];
    if (name.value.trim().length < 2) problems.push("Enter your name.");
    if (email.value.indexOf("@") < 1) problems.push("Enter a full email address.");
    if (message.value.trim().length < 10) problems.push("Tell us a little more.");
    status.textContent = problems.length ? problems[0] : "Ready to send once this form is connected.";
    if (problems.length) submit.setAttribute("disabled", ""); else submit.removeAttribute("disabled");
  }
  form.addEventListener("input", check);
  check();
}`,
    }),
  },
  {
    id: "contact-booking-request",
    category: "contact",
    name: "Booking request",
    description: "Date, time and party size, validated locally, ending in a call-to-confirm. No fake reservation system.",
    kind: "contact",
    interactive: true,
    build: () => ({
      html: `<section class="c-section c-surface" data-canvas-id="booking" data-canvas-label="Booking request">
      <div class="c-container c-stack">
        <div class="c-stack">
          <p class="c-kicker">Reservations</p>
          <h2>Tell us when, then call to confirm</h2>
          <p class="c-muted">This page cannot hold a table on its own. Choose a time here, then call us and we will book it in.</p>
        </div>
        <div class="c-card c-stack booking-form" data-canvas-id="booking-form">
          <div class="c-grid">
            <label class="c-stack" for="booking-date"><span>Date</span><input id="booking-date" type="date"></label>
            <label class="c-stack" for="booking-time"><span>Time</span>
              <select id="booking-time">
                <option value="12:00">12:00</option>
                <option value="12:30">12:30</option>
                <option value="18:00">18:00</option>
                <option value="18:30">18:30</option>
                <option value="19:00">19:00</option>
                <option value="19:30">19:30</option>
                <option value="20:00">20:00</option>
              </select>
            </label>
            <label class="c-stack" for="booking-people"><span>People</span><input id="booking-people" type="number" min="1" max="12" value="2"></label>
          </div>
          <p class="booking-status" aria-live="polite">Choose a date to continue.</p>
          <div class="c-actions"><a class="c-button" href="tel:+15550100">Call (555) 010-0</a></div>
        </div>
      </div>
    </section>`,
      css: `.booking-form input,.booking-form select{width:100%;padding:var(--space-sm);border:var(--border-width) solid var(--color-border);border-radius:var(--radius-md);background:var(--color-background);color:var(--color-text);font:inherit}`,
      js: `var date = document.getElementById("booking-date");
var time = document.getElementById("booking-time");
var people = document.getElementById("booking-people");
var status = document.querySelector(".booking-status");
function summarise() {
  if (!status) return;
  var count = Number(people.value);
  status.textContent = date.value && count > 0
    ? "Call us and ask for " + date.value + " at " + time.value + " for " + count + "."
    : "Choose a date to continue.";
}
if (date && time && people) {
  date.addEventListener("input", summarise);
  time.addEventListener("change", summarise);
  people.addEventListener("input", summarise);
}`,
    }),
  },
  {
    id: "contact-locations",
    category: "contact",
    name: "Several locations",
    description: "One card per site, each with its own hours and phone. For businesses with more than one address.",
    kind: "contact",
    interactive: false,
    build: () => ({
      html: `<section class="c-section" data-canvas-id="locations" data-canvas-label="Locations">
      <div class="c-container c-stack">
        <div class="c-stack"><p class="c-kicker">Find us</p><h2>Three places to come and see us</h2></div>
        <div class="c-grid">
          <article class="c-card c-stack" data-canvas-id="location-1">
            <h3>City centre</h3>
            <p class="c-muted">12 Market Street, Springfield</p>
            <p><a class="c-link" href="tel:+15550100">(555) 010-0</a></p>
            <p class="c-muted">Mon–Sat, 9am–7pm</p>
          </article>
          <article class="c-card c-stack" data-canvas-id="location-2">
            <h3>Riverside</h3>
            <p class="c-muted">4 Wharf Lane, Springfield</p>
            <p><a class="c-link" href="tel:+15550101">(555) 010-1</a></p>
            <p class="c-muted">Tue–Sun, 10am–8pm</p>
          </article>
          <article class="c-card c-stack" data-canvas-id="location-3">
            <h3>Northgate</h3>
            <p class="c-muted">88 North Road, Springfield</p>
            <p><a class="c-link" href="tel:+15550102">(555) 010-2</a></p>
            <p class="c-muted">Mon–Fri, 8am–6pm</p>
          </article>
        </div>
      </div>
    </section>`,
    }),
  },
  {
    id: "contact-faq",
    category: "contact",
    name: "Questions then contact",
    description: "An expanding question list that answers the common ones, with a way through for the rest.",
    kind: "contact",
    interactive: true,
    build: () => ({
      html: `<section class="c-section" data-canvas-id="faq" data-canvas-label="Questions">
      <div class="c-container c-stack">
        <div class="c-stack"><p class="c-kicker">Before you call</p><h2>The questions we are asked most</h2></div>
        <div class="c-stack" data-canvas-id="faq-list">
          <div class="c-card c-stack faq-item">
            <h3><button type="button" class="c-button-secondary faq-toggle" aria-expanded="false" aria-controls="faq-hours">When are you open?</button></h3>
            <p class="c-muted" id="faq-hours" hidden>Monday to Friday, 8am to 6pm, and Saturday mornings.</p>
          </div>
          <div class="c-card c-stack faq-item">
            <h3><button type="button" class="c-button-secondary faq-toggle" aria-expanded="false" aria-controls="faq-area">Where do you cover?</button></h3>
            <p class="c-muted" id="faq-area" hidden>Springfield and everywhere within about 20 miles of it.</p>
          </div>
          <div class="c-card c-stack faq-item">
            <h3><button type="button" class="c-button-secondary faq-toggle" aria-expanded="false" aria-controls="faq-quotes">Do you charge for a quote?</button></h3>
            <p class="c-muted" id="faq-quotes" hidden>No. Quotes are free and fixed in writing before any work starts.</p>
          </div>
          <div class="c-card c-stack faq-item">
            <h3><button type="button" class="c-button-secondary faq-toggle" aria-expanded="false" aria-controls="faq-payment">How do I pay?</button></h3>
            <p class="c-muted" id="faq-payment" hidden>Card or bank transfer, on completion, unless we agreed otherwise.</p>
          </div>
        </div>
        <div class="c-actions"><a class="c-button" href="mailto:hello@example.com">Ask something else</a></div>
      </div>
    </section>`,
      css: `.faq-item h3{margin:0}`,
      // One open answer at a time, expressed on the control and the panel rather than by
      // adding and removing elements, so ids survive and the state is announced.
      js: `var toggles = document.querySelectorAll(".faq-toggle");
for (var index = 0; index < toggles.length; index += 1) {
  toggles[index].addEventListener("click", function (event) {
    var control = event.currentTarget;
    var open = control.getAttribute("aria-expanded") === "true";
    for (var other = 0; other < toggles.length; other += 1) {
      var panel = document.getElementById(toggles[other].getAttribute("aria-controls"));
      var active = toggles[other] === control && !open;
      toggles[other].setAttribute("aria-expanded", active ? "true" : "false");
      if (panel) { if (active) panel.removeAttribute("hidden"); else panel.setAttribute("hidden", ""); }
    }
  });
}`,
    }),
  },
];
