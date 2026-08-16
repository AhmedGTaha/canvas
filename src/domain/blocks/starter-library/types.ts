/**
 * The built-in Reusable Section catalog.
 *
 * These definitions belong to Canvas, not to any project: they are immutable, they are
 * never written into a project on creation, and nothing in a project points back at
 * them. Choosing one copies its source into a normal project-owned Building Block with
 * its own first Block Version, after which it is an ordinary block — editable by the
 * agent, duplicable, shareable across pages, versioned, archivable.
 *
 * A template is a function of a small, safe context rather than a fixed string, because
 * a navbar has to link to the pages a project actually has. Everything a template emits
 * still goes through the same generated-source validator as AI output; none of these
 * templates are trusted.
 */
export type StarterCategory = "navbar" | "footer" | "hero" | "product_card" | "testimonial" | "pricing" | "contact" | "services";

export const STARTER_CATEGORIES: readonly StarterCategory[] = ["navbar", "footer", "hero", "product_card", "testimonial", "pricing", "contact", "services"];

export const STARTER_CATEGORY_LABELS: Record<StarterCategory, string> = {
  navbar: "Navbar", footer: "Footer", hero: "Hero", product_card: "Product Card",
  testimonial: "Testimonial", pricing: "Pricing", contact: "Contact", services: "Services",
};

/** Everything a template may know about the project it is being copied into. */
export type StarterContext = {
  companyName: string;
  /** Real, active routes only. Empty when the project has no other pages yet. */
  links: ReadonlyArray<{ name: string; href: string }>;
};

export type StarterSection = {
  id: string;
  category: StarterCategory;
  name: string;
  /** One line on what makes this variant different from its siblings. */
  description: string;
  /** The `kind` given to the project-owned Building Block. */
  kind: string;
  /** True when the template uses React state, so the copy is a client component. */
  interactive: boolean;
  build: (context: StarterContext) => string;
};

/** Navigation links, capped so a bar stays a bar, with a safe fallback for a new project. */
export function navigationLinks(context: StarterContext, limit = 5) {
  const links = context.links.slice(0, limit);
  // A project with no routes yet gets a local anchor rather than a link to a page that
  // does not exist: the validator rejects internal links to inactive routes, so a
  // guessed "/" would stop the starter installing at all.
  return links.length ? links : [{ name: "Home", href: "#" }];
}

/**
 * The project's own home route, or a local anchor when it has no pages yet.
 *
 * Templates never hard-code a route: the generated-source validator only accepts
 * internal links to routes that actually exist, so a starter that guessed "/contact"
 * would simply fail to install into a project that has no contact page.
 */
export function home(context: StarterContext) {
  return context.links.find((link) => link.href === "/")?.href ?? context.links[0]?.href ?? "#";
}

/** The best available destination for a call to action in this project. */
export function cta(context: StarterContext) {
  const preferred = ["/contact", "/reservations", "/reservation", "/book", "/booking", "/enquire", "/quote"];
  const match = context.links.find((link) => preferred.includes(link.href.toLowerCase()));
  return match?.href ?? home(context);
}

/** A JSX-safe rendering of user-supplied text. */
export function text(value: string) {
  return value.replace(/[{}<>]/g, "").trim() || "Your company";
}
