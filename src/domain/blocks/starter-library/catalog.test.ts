import { describe, expect, it } from "vitest";
import { validateGeneratedBlockSource } from "@/domain/blocks/validation";
import { findStarterSection, STARTER_CATEGORIES, STARTER_SECTIONS, starterCatalogView, startersByCategory, type StarterContext } from "./catalog";

/** A project with real pages, which is what a navbar template needs to link to. */
const PROJECT: StarterContext = {
  companyName: "Osteria Vela",
  links: [
    { name: "Home", href: "/" },
    { name: "Menu", href: "/menu" },
    { name: "About", href: "/about" },
    { name: "Gallery", href: "/gallery" },
    { name: "Contact", href: "/contact" },
  ],
};
/** A project on its first day: one page, no routes to link to yet. */
const NEW_PROJECT: StarterContext = { companyName: "New Company", links: [] };

const scope = (context: StarterContext) => ({
  approvedMediaIds: new Set<string>(),
  activeRoutes: new Set(context.links.map((link) => link.href)),
});

describe("built-in starter section catalog", () => {
  it("ships five variants in each required category", () => {
    for (const category of STARTER_CATEGORIES) {
      const sections = STARTER_SECTIONS.filter((section) => section.category === category);
      expect(sections.length, `${category} variants`).toBe(5);
    }
    expect(STARTER_SECTIONS.length).toBe(40);
  });

  it("gives every starter a unique id and a distinct name inside its category", () => {
    expect(new Set(STARTER_SECTIONS.map((section) => section.id)).size).toBe(STARTER_SECTIONS.length);
    for (const { category, sections } of startersByCategory()) {
      expect(new Set(sections.map((section) => section.name)).size, `${category} names`).toBe(sections.length);
      expect(new Set(sections.map((section) => section.description)).size, `${category} descriptions`).toBe(sections.length);
    }
  });

  it("offers real interactivity somewhere in the library without forcing it everywhere", () => {
    const interactive = STARTER_SECTIONS.filter((section) => section.interactive);
    expect(interactive.length).toBeGreaterThanOrEqual(6);
    expect(interactive.length).toBeLessThan(STARTER_SECTIONS.length / 2);
  });

  it("never exposes template source in the catalog listing", () => {
    for (const entry of starterCatalogView()) expect(Object.keys(entry)).not.toContain("build");
  });

  it("is immutable", () => {
    expect(Object.isFrozen(STARTER_SECTIONS)).toBe(true);
    for (const section of STARTER_SECTIONS) expect(Object.isFrozen(section)).toBe(true);
    expect(() => { (STARTER_SECTIONS as unknown as { push: (value: unknown) => void }).push({}); }).toThrow();
    const navbar = findStarterSection("navbar-classic")!;
    expect(() => { (navbar as unknown as { name: string }).name = "changed"; }).toThrow();
    expect(findStarterSection("navbar-classic")?.name).toBe("Classic bar");
  });

  it.each(STARTER_SECTIONS.map((section) => [section.id, section] as const))("%s passes generated-source validation in a real project", async (_id, section) => {
    const manifest = await validateGeneratedBlockSource({ sourceCode: section.build(PROJECT), ...scope(PROJECT) });
    expect(manifest.editableElements.length).toBeGreaterThan(0);
    expect(manifest.usesClientInteractivity).toBe(section.interactive);
    // Templates cannot depend on project Media, because a brand-new project has none.
    expect(manifest.referencedMediaIds).toEqual([]);
  });

  it.each(STARTER_SECTIONS.map((section) => [section.id, section] as const))("%s also installs into a project with no pages yet", async (_id, section) => {
    await expect(validateGeneratedBlockSource({ sourceCode: section.build(NEW_PROJECT), ...scope(NEW_PROJECT) })).resolves.toBeTruthy();
  });

  it("links navigation at the routes the project actually has", () => {
    const navbar = findStarterSection("navbar-classic")!;
    const source = navbar.build(PROJECT);
    for (const link of PROJECT.links) expect(source).toContain(`href="${link.href}"`);
    // And invents nothing when there is nowhere to point.
    expect(navbar.build(NEW_PROJECT)).not.toContain('href="/menu"');
  });

  it("never claims backend behaviour in a form-bearing starter", () => {
    const forms = STARTER_SECTIONS.filter((section) => /<form|<input|<textarea/.test(section.build(PROJECT)));
    expect(forms.length).toBeGreaterThan(0);
    for (const section of forms) {
      const source = section.build(PROJECT);
      expect(source).not.toMatch(/<form[^>]*\s(action|method)=/);
      // Each one says out loud that nothing is submitted.
      expect(source).toMatch(/does not send|cannot hold|before launch|Connect|connected/i);
    }
  });
});
