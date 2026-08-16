import { CONTACT_STARTERS } from "./contact";
import { FOOTER_STARTERS } from "./footer";
import { HERO_STARTERS } from "./hero";
import { NAVBAR_STARTERS } from "./navbar";
import { PRICING_STARTERS } from "./pricing";
import { PRODUCT_CARD_STARTERS } from "./product-card";
import { SERVICES_STARTERS } from "./services";
import { TESTIMONIAL_STARTERS } from "./testimonial";
import { STARTER_CATEGORIES, type StarterCategory, type StarterSection } from "./types";

export * from "./types";

/**
 * The whole built-in catalog, frozen.
 *
 * Frozen is not decoration: these definitions are application-owned and immutable, and a
 * project only ever receives a *copy* of one. Nothing in a project references a catalog
 * entry, so changing this file never rewrites anybody's website.
 */
export const STARTER_SECTIONS: readonly StarterSection[] = Object.freeze([
  ...NAVBAR_STARTERS,
  ...FOOTER_STARTERS,
  ...HERO_STARTERS,
  ...PRODUCT_CARD_STARTERS,
  ...TESTIMONIAL_STARTERS,
  ...PRICING_STARTERS,
  ...CONTACT_STARTERS,
  ...SERVICES_STARTERS,
].map((section) => Object.freeze(section)));

export function findStarterSection(id: string): StarterSection | null {
  return STARTER_SECTIONS.find((section) => section.id === id) ?? null;
}

export function startersByCategory(): Array<{ category: StarterCategory; sections: StarterSection[] }> {
  return STARTER_CATEGORIES.map((category) => ({ category, sections: STARTER_SECTIONS.filter((section) => section.category === category) }));
}

/** Catalog listing for the picker: identity and description only, never source. */
export function starterCatalogView() {
  return STARTER_SECTIONS.map(({ id, category, name, description, kind, interactive }) => ({ id, category, name, description, kind, interactive }));
}
