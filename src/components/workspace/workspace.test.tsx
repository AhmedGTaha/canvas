/** @vitest-environment jsdom */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// The explorer calls a server action and Next's router; neither exists in jsdom.
type TreeResult = { error?: string; success?: string; createdNodeId?: string };
const pageTreeAction = vi.fn((...args: [TreeResult, FormData]): Promise<TreeResult> => { void args; return Promise.resolve({ success: "Changes saved.", createdNodeId: "new-page" }); });
const push = vi.fn();
const replace = vi.fn();
const back = vi.fn();
const refresh = vi.fn();
const redirect = vi.fn((href: string) => { throw new Error(`REDIRECT:${href}`); });
vi.mock("@/app/actions/pages", () => ({ pageTreeAction }));
vi.mock("@/app/actions/media", () => ({ mediaAction: vi.fn(() => Promise.resolve({ ok: true, message: "Changes saved." })) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace, back, refresh }), redirect }));

const { Explorer } = await import("./explorer");
const { ContextSidebar } = await import("./context-sidebar");
const { FeaturePanel } = await import("./feature-panel");
const { MediaManager } = await import("@/components/media/media-manager");
const { closedPanelHref, notePanelPushed, panelHref, resetPanelHistory, takePanelPushed } = await import("./panel-url");

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

  it("starts the same inline creation flow from command and activity entry points", async () => {
    const view = renderExplorer({ createRequest: { type: "folder", key: 1 } });
    await waitFor(() => expect(screen.getByLabelText("Rename New folder")).toBeDefined());
    view.onTreeChanged.mockClear();
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

/*
 * Project tools are a parameter on the project URL, never a route of their own.
 * That is the whole fix for landing on a bare tool screen after an upload: with
 * no second route, no navigation has anywhere else to go.
 */
describe("project tool panels", () => {
  const projectRoute = "src/app/(workspace)/projects/[projectId]";

  beforeEach(() => {
    for (const spy of [push, replace, back, refresh, redirect]) spy.mockClear();
    resetPanelHistory();
    window.history.replaceState({}, "", "/projects/p");
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.open = true; };
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.open = false; };
  });

  it("keeps every unrelated parameter when a tool opens, and drops only the tool when it closes", () => {
    const url = new URL("https://canvas.test/projects/p?page=home");
    expect(panelHref(url, "media")).toBe("/projects/p?page=home&tool=media");
    expect(panelHref(url, "pages", { node: "svc" })).toBe("/projects/p?page=home&tool=pages&node=svc");
    // Switching away from a node-scoped tool must not carry the node with it.
    expect(panelHref(new URL("https://canvas.test/projects/p?tool=pages&node=svc"), "media")).toBe("/projects/p?tool=media");
    expect(closedPanelHref(new URL("https://canvas.test/projects/p?page=home&tool=pages&node=svc"))).toBe("/projects/p?page=home");
  });

  it("only steps back for tools the workspace itself pushed", () => {
    expect(takePanelPushed()).toBe(false);
    notePanelPushed();
    expect(takePanelPushed()).toBe(true);
    expect(takePanelPushed()).toBe(false);
  });

  it("leaves no route that renders a project tool without the workspace behind it", () => {
    // The parallel slot and its intercepted twin were the second route that
    // hard navigations fell back to.
    expect(existsSync(join(projectRoute, "@panel"))).toBe(false);

    const routes = readdirSync(projectRoute, { recursive: true, encoding: "utf8" }).filter((entry) => entry.endsWith("page.tsx"));
    const resolvers = routes.filter((entry) => readFileSync(join(projectRoute, entry), "utf8").includes("resolvePanel"));
    expect(resolvers).toEqual(["page.tsx"]);

    const projectPage = readFileSync(join(projectRoute, "page.tsx"), "utf8");
    expect(projectPage).toContain("<WorkspaceShell");
    expect(projectPage).toContain("<FeaturePanel");
    // Every other route under a project forwards onto that one page.
    for (const entry of routes.filter((route) => route !== "page.tsx")) {
      const source = readFileSync(join(projectRoute, entry), "utf8");
      expect(source, `${entry} should only redirect`).toContain("redirect(`/projects/");
      expect(source, `${entry} should render nothing of its own`).not.toMatch(/return </);
    }
  });

  it("forwards old panel bookmarks onto the workspace URL", async () => {
    const { default: legacyPanel } = await import("@/app/(workspace)/projects/[projectId]/panel/[name]/page");
    const { default: legacyMedia } = await import("@/app/(workspace)/projects/[projectId]/media/page");

    const target = async (run: Promise<unknown>) => { try { await run; } catch (error) { return (error as Error).message.replace("REDIRECT:", ""); } throw new Error("expected a redirect"); };
    expect(await target(legacyPanel({ params: Promise.resolve({ projectId: "p", name: "media" }), searchParams: Promise.resolve({}) })))
      .toBe("/projects/p?tool=media");
    expect(await target(legacyPanel({ params: Promise.resolve({ projectId: "p", name: "pages" }), searchParams: Promise.resolve({ node: "svc" }) })))
      .toBe("/projects/p?tool=pages&node=svc");
    // A tool name that no longer exists opens the website rather than 404ing.
    expect(await target(legacyPanel({ params: Promise.resolve({ projectId: "p", name: "nonsense" }), searchParams: Promise.resolve({}) })))
      .toBe("/projects/p");
    expect(await target(legacyMedia({ params: Promise.resolve({ projectId: "p" }) }))).toBe("/projects/p?tool=media");
  });

  it("keeps the website visible and navigates nowhere while images upload", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })));
    render(<>
      <div data-testid="workspace">Website preview</div>
      <FeaturePanel title="Images"><MediaManager projectId="p" initialFolders={[]} initialAssets={[]} /></FeaturePanel>
    </>);

    const field = document.querySelector<HTMLInputElement>("input[type=file]")!;
    Object.defineProperty(field, "files", { value: [new File(["binary"], "logo.png", { type: "image/png" })] });
    await act(async () => { fireEvent.change(field); });

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    // The upload refreshes the data behind the panel. It must not move the app:
    // the website is still mounted, the tool is still an overlay on top of it,
    // and nothing navigated to a screen of its own.
    expect(screen.getByTestId("workspace")).toBeDefined();
    expect(document.querySelector("dialog")!.open).toBe(true);
    expect(screen.getByText("logo.png: done")).toBeDefined();
    for (const spy of [push, replace, back]) expect(spy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

/*
 * Sidebar-first: anything doable in the sidebar belongs there, and a row that
 * names one thing must open that thing rather than the tool's front page.
 */
describe("sidebar-first project tools", () => {
  const controller = {
    busy: false, canUndo: false, canRedo: false, undoLabel: "Nothing to undo", redoLabel: "Nothing to redo",
    pendingChanges: 0, hasCheckpoint: false, activity: [], versions: null, checkpoints: null, target: null,
    undo: vi.fn(), redo: vi.fn(), loadVersions: vi.fn(), loadCheckpoints: vi.fn(),
    restoreVersion: vi.fn(), restoreCheckpoint: vi.fn(), saveCheckpoint: vi.fn(),
  };
  const asset = { id: "asset-1", displayName: "Hero photo", altText: "", folderId: null } as never;
  const blocks = {
    "block-1": { id: "block-1", name: "Primary navbar", kind: "navbar", isGlobal: true, activeVersionId: "v1", contentStatus: "generated" as const },
    "block-2": { id: "block-2", name: "Site footer", kind: "footer", isGlobal: false, activeVersionId: null, contentStatus: "unbuilt" as const },
  };

  function renderSidebar(activity: "assets" | "design" | "sections", overrides: { mediaAssets?: unknown[] } = {}) {
    const onOpenPanel = vi.fn();
    render(<ContextSidebar
      projectId="p1"
      activity={activity}
      mediaAssets={(overrides.mediaAssets ?? [asset]) as never}
      mediaFolders={[]}
      blocks={blocks}
      website={<div />}
      history={controller as never}
      historySection={null}
      onOpenPanel={onOpenPanel}
      onNewBlock={vi.fn()}
      onHistorySection={vi.fn()}
    />);
    return { onOpenPanel };
  }

  beforeEach(() => { for (const spy of [push, replace, back, refresh]) spy.mockClear(); });

  it("uploads images from the sidebar without opening a panel", async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
    vi.stubGlobal("fetch", fetchMock);
    const { onOpenPanel } = renderSidebar("assets");

    const field = document.querySelector<HTMLInputElement>("input[type=file]")!;
    Object.defineProperty(field, "files", { value: [new File(["binary"], "hero.png", { type: "image/png" })] });
    await act(async () => { fireEvent.change(field); });

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p1/media", expect.objectContaining({ method: "POST" }));
    expect(screen.getByText(/hero\.png: done/)).toBeDefined();
    // The whole point: the most common thing anyone does with media needs no popup.
    expect(onOpenPanel).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("offers uploading even when there is nothing in the library yet", () => {
    renderSidebar("assets", { mediaAssets: [] });
    expect(screen.getByRole("button", { name: "Upload images", hidden: true })).toBeDefined();
  });

  it("opens each tool on the thing the row names", () => {
    const assets = renderSidebar("assets");
    fireEvent.click(screen.getByTitle("Hero photo"));
    expect(assets.onOpenPanel).toHaveBeenCalledWith("media", { asset: "asset-1" });
    cleanup();

    const design = renderSidebar("design");
    fireEvent.click(screen.getByText("Brand identity"));
    fireEvent.click(screen.getByText("Theme"));
    // Both rows used to open Brand at the top, which made the second one pointless.
    expect(design.onOpenPanel).toHaveBeenNthCalledWith(1, "brand", { section: "identity" });
    expect(design.onOpenPanel).toHaveBeenNthCalledWith(2, "brand", { section: "theme" });
    cleanup();

    const sections = renderSidebar("sections");
    fireEvent.click(screen.getByText("Site footer"));
    expect(sections.onOpenPanel).toHaveBeenCalledWith("blocks", { block: "block-2" });
  });

  it("carries nothing from one tool's view into the next", () => {
    const opened = panelHref(new URL("https://canvas.test/projects/p?page=home&tool=blocks&block=block-2"), "media", { asset: "asset-1" });
    expect(opened).toBe("/projects/p?page=home&tool=media&asset=asset-1");
    expect(closedPanelHref(new URL(`https://canvas.test${opened}`))).toBe("/projects/p?page=home");
  });
});

describe("workspace responsive strategy", () => {
  const css = readFileSync("src/app/workspace.css", "utf8") + readFileSync("src/app/workspace-redesign.css", "utf8");

  it("declares the progressive collapse breakpoints", () => {
    const queries = [...css.matchAll(/@media \(max-width:\s*(\d+)px\)/g)].map((match) => Number(match[1]));
    for (const width of [1279, 767]) expect(queries).toContain(width);
  });

  it("never squeezes three columns onto a tablet or phone", () => {
    const tablet = css.slice(css.lastIndexOf("@media (max-width:1279px)"), css.lastIndexOf("@media (max-width:767px)"));
    const phone = css.slice(css.lastIndexOf("@media (max-width:767px)"));
    expect(tablet).toMatch(/data-agent=.*\.ws-pane-r\{position:fixed/);
    expect(phone).toContain('data-surface="tools"');
    expect(phone).toContain('data-surface="preview"');
    expect(phone).toContain('data-surface="agent"');
  });

  it("keeps panels inside the viewport on phones", () => {
    const phone = css.slice(css.lastIndexOf("@media (max-width:767px)"));
    expect(phone).toMatch(/\.ws-panel-wide,\.ws-panel-drawer\{[^}]*top:0[^}]*left:0/);
  });

  it("keeps the agent composer visible when its conversation is long", () => {
    expect(css).toMatch(/\.ws-pane\s*\{[^}]*min-height:\s*0/);
    expect(css).toMatch(/\.wsa-thread\s*\{[^}]*min-height:\s*0[^}]*overflow-y:\s*auto/);
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

  /*
   * Panels are fixed-position siblings of .ws-shell, so anything they size
   * themselves from has to be visible from outside the shell. A var() they
   * cannot resolve is invalid at computed-value time: the inset silently
   * becomes auto, the panel grows to fit its content, and Brand and Reusable
   * Sections run off the bottom of the screen with nothing left to scroll.
   */
  it("sizes panels only from custom properties declared outside the shell", () => {
    const sheets = css + readFileSync("src/app/globals.css", "utf8");
    const used = new Set([...sheets.matchAll(/[^{}]*\.ws-panel[^{}]*\{([^{}]*)\}/g)]
      .flatMap(([, body]) => [...body!.matchAll(/var\((--[\w-]+)/g)].map(([, name]) => name!)));
    // Guards the parse itself: these two are what the insets are built from.
    for (const name of ["--ws-title-h", "--ws-statusbar-h"]) expect(used.has(name)).toBe(true);

    for (const name of used) {
      expect(sheets, `${name} styles a panel but is never declared at :root, so a panel cannot resolve it`)
        .toMatch(new RegExp(String.raw`:root\s*\{[^{}]*${name}\s*:`));
      // A second declaration on .ws-shell would let the shell and its panels
      // disagree about where the chrome ends.
      expect(sheets, `${name} is also declared on .ws-shell, which shadows the :root value only for the shell`)
        .not.toMatch(new RegExp(String.raw`\.ws-shell\s*\{[^{}]*${name}\s*:`));
    }
  });

  it("gives every panel a top and a bottom wherever it sets an inset", () => {
    // With either end unset the panel falls back to its content height, grows
    // past the viewport, and leaves its body nothing to scroll.
    const insets = ["top", "right", "bottom", "left", "inset"];
    for (const [name, sheet] of [
      ["desktop", css.slice(0, css.indexOf("@media (max-width:1279px)"))],
      ["phone", css.slice(css.lastIndexOf("@media (max-width:767px)"))],
    ] as const) {
      const found = [...sheet.matchAll(/\.ws-panel-(wide|drawer)[^{]*\{([^}]*)\}/g)];
      expect(found.length, `${name} defines no panel geometry`).toBeGreaterThan(0);
      let checked = 0;
      for (const [, variant, body] of found) {
        const properties = new Set(body!.split(";").map((declaration) => declaration.split(":")[0]!.trim()));
        if (!insets.some((inset) => properties.has(inset))) continue;
        checked += 1;
        for (const inset of ["top", "bottom"]) {
          expect(properties.has(inset) || properties.has("inset"), `${name} .ws-panel-${variant} sets some insets but leaves ${inset} unset`).toBe(true);
        }
      }
      expect(checked, `${name} sets no panel insets at all`).toBeGreaterThan(0);
    }
  });

  it("caps no column inside a panel at a pixel height the panel may be shorter than", () => {
    // A nested scroll region taller than the panel body puts its own scrollbar
    // below the fold, so reaching the bottom of it takes two scrolls.
    const capped = [...css.matchAll(/\.ws-panel-bd [^{]*\{([^}]*)\}/g)]
      .filter(([, body]) => /max-height:\s*\d+px/.test(body!))
      .map(([rule]) => rule);
    expect(capped).toEqual([]);
    // And the caps the reused page components declare are lifted in a panel.
    expect(css).toMatch(/\.ws-panel-bd \.blocks-list-panel,\s+\.ws-panel-bd \.builder-pages \{ max-height: none; \}/);
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
