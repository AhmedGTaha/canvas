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
    build: (context) => `export default function Contact() {
  return (
    <section className="c-section" data-canvas-id="contact" data-canvas-label="Contact">
      <div className="c-container c-stack">
        <div className="c-stack"><p className="c-kicker">Contact</p><h2>How to reach ${text(context.companyName)}</h2></div>
        <div className="c-grid">
          <div className="c-stack" data-canvas-id="contact-phone"><h3>Phone</h3><p><a className="c-link" href="tel:+15550100">(555) 010-0</a></p><p className="c-muted">Monday to Friday, 8am–6pm</p></div>
          <div className="c-stack" data-canvas-id="contact-email"><h3>Email</h3><p><a className="c-link" href="mailto:hello@example.com">hello@example.com</a></p><p className="c-muted">We reply within one working day</p></div>
          <div className="c-stack" data-canvas-id="contact-address"><h3>Visit</h3><p>12 Market Street<br />Springfield</p><p className="c-muted">Parking behind the building</p></div>
        </div>
      </div>
    </section>
  );
}
`,
  },
  {
    id: "contact-form-split",
    category: "contact",
    name: "Form beside details",
    description: "A validating enquiry form on one side, real contact details on the other.",
    kind: "contact",
    interactive: true,
    build: () => `"use client";
import { useState } from "react";

export default function Contact() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const errors = [
    name.trim().length < 2 ? "Enter your name." : "",
    email.includes("@") ? "" : "Enter a full email address.",
    message.trim().length < 10 ? "Tell us a little more." : "",
  ].filter(Boolean);

  return (
    <section className="c-section" data-canvas-id="contact" data-canvas-label="Contact">
      <div className="c-container">
        <div className="c-grid">
          <form className="c-card c-stack" data-canvas-id="contact-form">
            <h2>Send us a message</h2>
            <p className="c-muted">This form checks what you type but does not send anything yet. Connect it to your own email service before launch.</p>
            <label className="c-stack" htmlFor="contact-name"><span>Your name</span><input id="contact-name" type="text" value={name} onChange={(event) => setName(event.target.value)} /></label>
            <label className="c-stack" htmlFor="contact-email"><span>Email address</span><input id="contact-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <label className="c-stack" htmlFor="contact-message"><span>What can we help with?</span><textarea id="contact-message" rows={4} value={message} onChange={(event) => setMessage(event.target.value)} /></label>
            <p className="c-muted" aria-live="polite">{errors.length ? errors[0] : "Ready to send once this form is connected."}</p>
            <button type="button" className="c-button" disabled={errors.length > 0}>Send message</button>
          </form>
          <div className="c-stack" data-canvas-id="contact-details">
            <h2>Or reach us directly</h2>
            <p><a className="c-link" href="tel:+15550100">(555) 010-0</a></p>
            <p><a className="c-link" href="mailto:hello@example.com">hello@example.com</a></p>
            <p className="c-muted">12 Market Street, Springfield</p>
            <p className="c-muted">Monday to Friday, 8am–6pm</p>
          </div>
        </div>
      </div>
    </section>
  );
}
`,
  },
  {
    id: "contact-booking-request",
    category: "contact",
    name: "Booking request",
    description: "Date, time and party size, validated locally, ending in a call-to-confirm. No fake reservation system.",
    kind: "contact",
    interactive: true,
    build: () => `"use client";
import { useState } from "react";

const TIMES = ["12:00", "12:30", "18:00", "18:30", "19:00", "19:30", "20:00"];

export default function BookingRequest() {
  const [date, setDate] = useState("");
  const [time, setTime] = useState(TIMES[0]);
  const [people, setPeople] = useState(2);
  const ready = date.length > 0 && people > 0;

  return (
    <section className="c-section c-surface" data-canvas-id="booking" data-canvas-label="Booking request">
      <div className="c-container c-stack">
        <div className="c-stack">
          <p className="c-kicker">Reservations</p>
          <h2>Tell us when, then call to confirm</h2>
          <p className="c-muted">This page cannot hold a table on its own. Choose a time here, then call us and we will book it in.</p>
        </div>
        <div className="c-card c-stack" data-canvas-id="booking-form">
          <div className="c-grid">
            <label className="c-stack" htmlFor="booking-date"><span>Date</span><input id="booking-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
            <label className="c-stack" htmlFor="booking-time"><span>Time</span>
              <select id="booking-time" value={time} onChange={(event) => setTime(event.target.value)}>
                {TIMES.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className="c-stack" htmlFor="booking-people"><span>People</span><input id="booking-people" type="number" min={1} max={12} value={people} onChange={(event) => setPeople(Number(event.target.value))} /></label>
          </div>
          <p aria-live="polite">{ready ? "Call us and ask for " + date + " at " + time + " for " + people + "." : "Choose a date to continue."}</p>
          <div className="c-actions"><a className="c-button" href="tel:+15550100">Call (555) 010-0</a></div>
        </div>
      </div>
    </section>
  );
}
`,
  },
  {
    id: "contact-locations",
    category: "contact",
    name: "Several locations",
    description: "One card per site, each with its own hours and phone. For businesses with more than one address.",
    kind: "contact",
    interactive: false,
    build: () => `export default function Locations() {
  return (
    <section className="c-section" data-canvas-id="locations" data-canvas-label="Locations">
      <div className="c-container c-stack">
        <div className="c-stack"><p className="c-kicker">Find us</p><h2>Three places to come and see us</h2></div>
        <div className="c-grid">
          <article className="c-card c-stack" data-canvas-id="location-1">
            <h3>City centre</h3>
            <p className="c-muted">12 Market Street, Springfield</p>
            <p><a className="c-link" href="tel:+15550100">(555) 010-0</a></p>
            <p className="c-muted">Mon–Sat, 9am–7pm</p>
          </article>
          <article className="c-card c-stack" data-canvas-id="location-2">
            <h3>Riverside</h3>
            <p className="c-muted">4 Wharf Lane, Springfield</p>
            <p><a className="c-link" href="tel:+15550101">(555) 010-1</a></p>
            <p className="c-muted">Tue–Sun, 10am–8pm</p>
          </article>
          <article className="c-card c-stack" data-canvas-id="location-3">
            <h3>Northgate</h3>
            <p className="c-muted">88 North Road, Springfield</p>
            <p><a className="c-link" href="tel:+15550102">(555) 010-2</a></p>
            <p className="c-muted">Mon–Fri, 8am–6pm</p>
          </article>
        </div>
      </div>
    </section>
  );
}
`,
  },
  {
    id: "contact-faq",
    category: "contact",
    name: "Questions then contact",
    description: "An expanding question list that answers the common ones, with a way through for the rest.",
    kind: "contact",
    interactive: true,
    build: () => `"use client";
import { useState } from "react";

const QUESTIONS = [
  { id: "hours", question: "When are you open?", answer: "Monday to Friday, 8am to 6pm, and Saturday mornings." },
  { id: "area", question: "Where do you cover?", answer: "Springfield and everywhere within about 20 miles of it." },
  { id: "quotes", question: "Do you charge for a quote?", answer: "No. Quotes are free and fixed in writing before any work starts." },
  { id: "payment", question: "How do I pay?", answer: "Card or bank transfer, on completion, unless we agreed otherwise." },
];

export default function ContactFaq() {
  const [openId, setOpenId] = useState("");
  return (
    <section className="c-section" data-canvas-id="faq" data-canvas-label="Questions">
      <div className="c-container c-stack">
        <div className="c-stack"><p className="c-kicker">Before you call</p><h2>The questions we are asked most</h2></div>
        <div className="c-stack" data-canvas-id="faq-list">
          {QUESTIONS.map((item) => (
            <div key={item.id} className="c-card c-stack">
              <h3>
                <button type="button" className="c-button-secondary" aria-expanded={openId === item.id} onClick={() => setOpenId(openId === item.id ? "" : item.id)}>{item.question}</button>
              </h3>
              <p className="c-muted" hidden={openId !== item.id}>{item.answer}</p>
            </div>
          ))}
        </div>
        <div className="c-actions"><a className="c-button" href="mailto:hello@example.com">Ask something else</a></div>
      </div>
    </section>
  );
}
`,
  },
];
