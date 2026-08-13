/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// The explorer calls a server action and Next's router; neither exists in jsdom.
type TreeResult = { error?: string; success?: string; createdNodeId?: string };
const pageTreeAction = vi.fn((...args: [TreeResult, FormData]): Promise<TreeResult> => { void args; return Promise.resolve({ success: "Changes saved.", createdNodeId: "new-page" }); });
vi.mock("@/app/actions/pages", () => ({ pageTreeAction }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }) }));

const { Explorer } = await import("./explorer");
const { MenuBar } = await import("./menu-bar");

afterEach(() => { cleanup(); pageTreeAction.mockClear(); });

const NOW = new Date("2026-01-01T00:00:00Z");
function node(overrides: Record<string, unknown>) {
  return {
    id: "id", projectId: "p", parentId: null, type: "page", name: "Page", slug: null, routePath: "/", position: 0,
    isHomepage: false, pageTitle: null, metaDescription: null, createdByUserId: "u",
    createdAt: NOW, updatedAt: NOW, deletedAt: null, currentVersionId: "v1",
    ...overrides,
  } as never;
}

const NODES = [
  node({ id: "home", name: "Home", routePath: "/", isHomepage: true, position: 0 }),
  node({ id: "svc", name: "Services", type: "folder", routePath: null, position: 1 }),
  node({ id: "web", name: "Web Design", parentId: "svc", routePath: "/services/web-design", position: 0 }),
  node({ id: "draft", name: "Brand Systems", parentId: "svc", routePath: "/services/brand", position: 1, currentVersionId: null }),
  node({ id: "contact", name: "Contact", routePath: "/contact", position: 2 }),
];

function renderExplorer(overrides: Partial<Parameters<typeof Explorer>[0]> = {}) {
  const onSelectPage = vi.fn();
  const onEditWithAgent = vi.fn();
  const onOpenPagesPanel = vi.fn();
  const onTreeChanged = vi.fn();
  render(<Explorer
    projectId="p"
    nodes={NODES}
    currentPageId="web"
    routes={{ home: "/", web: "/services/web-design", draft: "/services/brand", contact: "/contact" }}
    onSelectPage={onSelectPage}
    onEditWithAgent={onEditWithAgent}
    onOpenPagesPanel={onOpenPagesPanel}
    onTreeChanged={onTreeChanged}
    {...overrides}
  />);
  return { onSelectPage, onEditWithAgent, onOpenPagesPanel, onTreeChanged };
}

describe("website explorer", () => {
  it("opens and closes a folder when the folder row is clicked, and nothing else", () => {
    const { onSelectPage, onEditWithAgent } = renderExplorer();
    // Children start visible.
    expect(screen.getByText("Web Design")).toBeDefined();

    fireEvent.click(screen.getByText("Services"));
    expect(screen.queryByText("Web Design")).toBeNull();
    // Clicking a folder must not change what is being edited — the behaviour
    // the old tree got wrong by scoping the AI on a folder click.
    expect(onSelectPage).not.toHaveBeenCalled();
    expect(onEditWithAgent).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Services"));
    expect(screen.getByText("Web Design")).toBeDefined();
  });

  it("collapses from the chevron as well as the row", () => {
    renderExplorer();
    const row = screen.getByText("Services").closest(".wsx-row")!;
    // The chevron is aria-hidden on purpose: the row button already exposes the
    // expand/collapse state, so screen readers get one control, not two.
    fireEvent.click(row.querySelector(".wsx-chevron")!);
    expect(screen.queryByText("Web Design")).toBeNull();
  });

  it("selects a page when a page row is clicked", () => {
    const { onSelectPage } = renderExplorer();
    fireEvent.click(screen.getByText("Contact"));
    expect(onSelectPage).toHaveBeenCalledWith("contact", "/contact");
  });

  it("marks the current page and shows home and draft state", () => {
    renderExplorer();
    expect(screen.getByText("Web Design").closest(".wsx-row")!.className).toContain("wsx-row-selected");
    // The home page carries a badge as well as its name, hence two matches.
    expect(screen.getByText("Home", { selector: ".wsx-name" })).toBeDefined();
    expect(screen.getByText("Home", { selector: ".wsx-badge-home" })).toBeDefined();
    // A page the agent has not built yet is labelled, not silently identical.
    expect(screen.getByText("Draft")).toBeDefined();
  });

  it("filters the tree and keeps ancestors of a nested match", () => {
    renderExplorer();
    fireEvent.change(screen.getByLabelText("Search pages and folders"), { target: { value: "web" } });
    expect(screen.getByText("Web Design")).toBeDefined();
    expect(screen.getByText("Services")).toBeDefined(); // ancestor kept
    expect(screen.queryByText("Contact")).toBeNull();
  });

  it("renames in place with F2 and abandons on Escape", () => {
    renderExplorer();
    fireEvent.keyDown(screen.getByText("Contact"), { key: "F2" });
    const field = screen.getByLabelText("Rename Contact") as HTMLInputElement;
    expect(field.value).toBe("Contact");
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.getByText("Contact")).toBeDefined();
  });

  it("creates a page by typing the name in the tree", () => {
    renderExplorer();
    fireEvent.click(screen.getByRole("button", { name: "New page" }));
    expect(screen.getByLabelText("Rename New page")).toBeDefined();
  });

  it("hands the new page's id up so the workspace can open it without a reload", async () => {
    const { onTreeChanged } = renderExplorer();
    fireEvent.click(screen.getByRole("button", { name: "New page" }));
    const field = screen.getByLabelText("Rename New page");
    fireEvent.change(field, { target: { value: "Pricing" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(onTreeChanged).toHaveBeenCalled());

    const submitted = pageTreeAction.mock.calls[0]![1];
    expect(submitted.get("intent")).toBe("create");
    expect(submitted.get("name")).toBe("Pricing");
    // The id is what lets the workspace mint a session containing the page and
    // open it; without it the preview manifest stays stale until a full reload.
    expect(onTreeChanged).toHaveBeenCalledWith("new-page");
  });

  it("reports edits that create nothing with no id to open", async () => {
    pageTreeAction.mockResolvedValueOnce({ success: "Changes saved." });
    const { onTreeChanged } = renderExplorer();
    fireEvent.keyDown(screen.getByText("Contact"), { key: "F2" });
    const field = screen.getByLabelText("Rename Contact");
    fireEvent.change(field, { target: { value: "Contact us" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(onTreeChanged).toHaveBeenCalledWith(undefined));
  });

  it("surfaces a failed edit instead of reporting a change", async () => {
    pageTreeAction.mockResolvedValueOnce({ error: "That name is already used." });
    const { onTreeChanged } = renderExplorer();
    fireEvent.keyDown(screen.getByText("Contact"), { key: "F2" });
    const field = screen.getByLabelText("Rename Contact");
    fireEvent.change(field, { target: { value: "Home" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("That name is already used."));
    expect(onTreeChanged).not.toHaveBeenCalled();
  });

  it("offers a way forward when the website has no pages", () => {
    renderExplorer({ nodes: [], currentPageId: null, routes: {} });
    expect(screen.getByRole("button", { name: /Create your first page/ })).toBeDefined();
  });
});

describe("application menu bar", () => {
  const groups = [
    { id: "project", label: "Project", entries: [{ kind: "item" as const, label: "Project settings…", onSelect: vi.fn() }] },
    { id: "view", label: "View", entries: [{ kind: "item" as const, label: "Website explorer", checked: true, onSelect: vi.fn() }] },
  ];

  it("opens a menu, exposes its items, and closes on a second click", () => {
    render(<MenuBar groups={groups} />);
    const trigger = screen.getByRole("button", { name: "Project" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("menuitem", { name: "Project settings…" })).toBeDefined();
    fireEvent.click(trigger);
    expect(screen.queryByRole("menuitem")).toBeNull();
  });

  it("closes on Escape and returns focus to the trigger", () => {
    render(<MenuBar groups={groups} />);
    const trigger = screen.getByRole("button", { name: "Project" });
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByRole("menuitem")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("reports toggle state so the View menu shows what is on", () => {
    render(<MenuBar groups={groups} />);
    fireEvent.click(screen.getByRole("button", { name: "View" }));
    expect(screen.getByRole("menuitemcheckbox", { name: "Website explorer" }).getAttribute("aria-checked")).toBe("true");
  });
});

describe("workspace responsive strategy", () => {
  const css = readFileSync("src/app/workspace.css", "utf8");

  it("declares the progressive collapse breakpoints", () => {
    const queries = [...css.matchAll(/@media \(max-width:\s*(\d+)px\)/g)].map((match) => Number(match[1]));
    for (const width of [1180, 1000, 720]) expect(queries).toContain(width);
  });

  it("never squeezes three columns onto a tablet or phone", () => {
    const tablet = css.slice(css.indexOf("@media (max-width: 1000px)"), css.indexOf("@media (max-width: 720px)"));
    const phone = css.slice(css.indexOf("@media (max-width: 720px)"));
    // Tablet drops to two columns and floats the agent over the stage.
    expect(tablet).toContain("grid-template-columns: var(--ws-explorer-w) minmax(0, 1fr)");
    expect(tablet).toMatch(/\.ws-shell\[data-agent="on"\] \.ws-pane-r \{[^}]*position: fixed/);
    // Phone gives the website the whole width; both panels become drawers.
    expect(phone).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(phone).toMatch(/\.ws-shell\[data-explorer="on"\] \.ws-pane-l \{[^}]*position: fixed/);
  });

  it("keeps panels inside the viewport on phones", () => {
    const phone = css.slice(css.indexOf("@media (max-width: 720px)"));
    expect(phone).toMatch(/\.ws-panel-wide, \.ws-panel-drawer \{[\s\S]{0,220}left: 8px/);
  });

  it("sizes panels from their insets so the body can scroll", () => {
    const panel = css.slice(css.indexOf(".ws-panel {"), css.indexOf(".ws-panel::backdrop"));
    // A <dialog> is width/height: fit-content per the UA stylesheet, which would
    // let a tall panel grow past the viewport and leave nothing scrollable.
    expect(panel).toMatch(/width: auto;/);
    expect(panel).toMatch(/height: auto;/);
    // A flex child needs min-height: 0 before overflow can shrink it.
    expect(css).toMatch(/\.ws-panel-bd \{[^}]*min-height: 0[^}]*overflow: auto/);
  });

  it("honours reduced motion", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toMatch(/\.ws-panel, \.ws-panel::backdrop \{ animation: none; \}/);
  });

  it("avoids CSS outside the supported browser matrix", () => {
    for (const pattern of [/:has\(/, /color-mix\(/, /@container\b/, /text-wrap:\s*(pretty|balance)/, /field-sizing:/, /anchor-name:/]) {
      expect(css).not.toMatch(pattern);
    }
  });
});
