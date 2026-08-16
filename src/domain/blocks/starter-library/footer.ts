import { navigationLinks, text, type StarterContext, type StarterSection } from "./types";

const links = (context: StarterContext, limit?: number) =>
  navigationLinks(context, limit).map((link) => `          <a class="c-link" href="${link.href}">${text(link.name)}</a>`).join("\n");

const year = "2026";

/**
 * Five footers along one axis that actually matters: how much a site needs to say at the
 * end. A single line, a two-column close, a full sitemap, a newsletter close, and a
 * contact-first footer for businesses people phone.
 */
export const FOOTER_STARTERS: StarterSection[] = [
  {
    id: "footer-minimal",
    category: "footer",
    name: "Single line",
    description: "Name, links and a copyright on one line. Nothing more, for sites that end quietly.",
    kind: "footer",
    interactive: false,
    build: (context) => ({
      html: `<footer class="c-section c-surface" data-canvas-id="footer" data-canvas-label="Footer">
      <div class="c-container c-cluster">
        <p class="c-muted">© ${year} ${text(context.companyName)}</p>
        <div class="c-row" data-canvas-id="footer-links">
${links(context)}
        </div>
      </div>
    </footer>`,
    }),
  },
  {
    id: "footer-two-column",
    category: "footer",
    name: "Statement and links",
    description: "A short positioning line on the left, navigation on the right. Balanced without a sitemap.",
    kind: "footer",
    interactive: false,
    build: (context) => ({
      html: `<footer class="c-section c-surface" data-canvas-id="footer" data-canvas-label="Footer">
      <div class="c-container c-stack">
        <div class="c-grid">
          <div class="c-stack" data-canvas-id="footer-statement">
            <strong>${text(context.companyName)}</strong>
            <p class="c-muted">Replace this line with what you do and who you do it for.</p>
          </div>
          <nav class="c-stack" aria-label="Footer" data-canvas-id="footer-links">
${links(context, 6)}
          </nav>
        </div>
        <p class="c-muted">© ${year} ${text(context.companyName)}. All rights reserved.</p>
      </div>
    </footer>`,
    }),
  },
  {
    id: "footer-sitemap",
    category: "footer",
    name: "Grouped sitemap",
    description: "Three labelled link groups plus legal. For larger sites where the footer is real navigation.",
    kind: "footer",
    interactive: false,
    build: (context) => ({
      html: `<footer class="c-section c-surface" data-canvas-id="footer" data-canvas-label="Footer">
      <div class="c-container c-stack">
        <div class="c-grid">
          <nav class="c-stack" aria-label="Site" data-canvas-id="footer-group-site">
            <p class="c-kicker">Site</p>
${links(context, 5)}
          </nav>
          <div class="c-stack" data-canvas-id="footer-group-contact">
            <p class="c-kicker">Contact</p>
            <a class="c-link" href="mailto:hello@example.com">hello@example.com</a>
            <a class="c-link" href="tel:+15550100">(555) 010-0</a>
            <p class="c-muted">12 Market Street, Springfield</p>
          </div>
          <div class="c-stack" data-canvas-id="footer-group-hours">
            <p class="c-kicker">Hours</p>
            <p class="c-muted">Monday to Friday, 8am–6pm</p>
            <p class="c-muted">Saturday, 9am–2pm</p>
          </div>
        </div>
        <p class="c-muted">© ${year} ${text(context.companyName)}</p>
      </div>
    </footer>`,
    }),
  },
  {
    id: "footer-signup",
    category: "footer",
    name: "Closing sign-up",
    description: "A local sign-up field above the links. The field is visual only — no backend is implied.",
    kind: "footer",
    interactive: true,
    build: (context) => ({
      html: `<footer class="c-section c-surface" data-canvas-id="footer" data-canvas-label="Footer">
      <div class="c-container c-stack">
        <div class="c-card c-stack" data-canvas-id="footer-signup">
          <h2>Occasional news, never noise</h2>
          <p class="c-muted">Connect this form to your own mailing provider before launch — nothing is sent yet.</p>
          <div class="c-actions">
            <label class="c-stack" for="footer-email">
              <span class="c-muted">Email address</span>
              <input id="footer-email" type="email" placeholder="you@example.com" autocomplete="email">
            </label>
            <button type="button" class="c-button footer-submit" disabled>Sign up</button>
          </div>
          <p class="c-muted footer-status" aria-live="polite"></p>
        </div>
        <div class="c-cluster">
          <p class="c-muted">© ${year} ${text(context.companyName)}</p>
          <nav class="c-row" aria-label="Footer" data-canvas-id="footer-links">
${links(context)}
          </nav>
        </div>
      </div>
    </footer>`,
      // Local validation only: the button never submits anywhere, which is exactly what
      // the copy above it promises.
      js: `var field = document.getElementById("footer-email");
var submit = document.querySelector(".footer-submit");
var status = document.querySelector(".footer-status");
if (field && submit && status) {
  field.addEventListener("input", function () {
    var value = field.value.trim();
    var valid = value.indexOf("@") > 0 && value.length > 4;
    if (valid) submit.removeAttribute("disabled"); else submit.setAttribute("disabled", "");
    status.textContent = value.length === 0 ? "" : valid ? "That address looks right." : "Enter a full email address.";
  });
}`,
    }),
  },
  {
    id: "footer-contact-first",
    category: "footer",
    name: "Contact first",
    description: "Phone, address and hours lead; links follow. For businesses people call rather than browse.",
    kind: "footer",
    interactive: false,
    build: (context) => ({
      html: `<footer class="c-section c-surface" data-canvas-id="footer" data-canvas-label="Footer">
      <div class="c-container c-stack">
        <div class="c-stack" data-canvas-id="footer-contact">
          <p class="c-kicker">${text(context.companyName)}</p>
          <h2><a class="c-link" href="tel:+15550100">(555) 010-0</a></h2>
          <p class="c-muted">12 Market Street, Springfield · Monday to Saturday</p>
        </div>
        <div class="c-cluster">
          <nav class="c-row" aria-label="Footer" data-canvas-id="footer-links">
${links(context)}
          </nav>
          <p class="c-muted">© ${year} ${text(context.companyName)}</p>
        </div>
      </div>
    </footer>`,
    }),
  },
];
