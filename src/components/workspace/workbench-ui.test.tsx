/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ActivityBar } from "./activity-bar";
import { PreviewStage } from "./preview-stage";
import { TitleBar } from "./title-bar";

beforeEach(() => { class Observer { observe() {} disconnect() {} } vi.stubGlobal("ResizeObserver", Observer); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("workspace chrome", () => {
  it("exposes every primary activity with names and selected state", () => {
    const select = vi.fn();
    render(<ActivityBar activity="website" sidebarOpen onActivity={select} onSettings={vi.fn()} onHelp={vi.fn()} />);
    for (const name of ["Website", "Assets", "Design", "Reusable Sections", "History", "Website settings", "Help and keyboard shortcuts"]) {
      expect(screen.getByRole("button", { name })).toBeDefined();
    }
    fireEvent.click(screen.getByRole("button", { name: "Assets" }));
    expect(select).toHaveBeenCalledWith("assets");
    expect(screen.getByRole("button", { name: "Website" }).getAttribute("aria-current")).toBe("page");
  });

  it("says where you are and keeps one account menu", () => {
    render(<TitleBar workspaceName="Studio" projectName="Site" pageName="Home" userName="Alex Smith" canShare activeTasks={0} failedTasks={0} agentOpen onSearch={vi.fn()} onShare={vi.fn()} onTasks={vi.fn()} onToggleAgent={vi.fn()} onSignOut={vi.fn()} />);
    // Workspace, website, page — the page is the thing edits apply to.
    for (const text of ["Studio", "Site", "Home"]) expect(screen.getByText(text)).toBeDefined();
    // The agent is named, not just drawn: on a laptop it is the only labelled
    // way back to the panel the website is built from.
    expect(screen.getByRole("button", { name: "Hide the agent" }).textContent).toContain("Agent");
    fireEvent.click(screen.getByRole("button", { name: /Account menu/ }));
    for (const name of ["Your websites", "Workspaces", "Account", "Sign out"]) {
      expect(screen.getByRole("menuitem", { name })).toBeDefined();
    }
  });

  it("provides navigation, page, device, zoom, selection, and overflow controls", () => {
    const page = vi.fn(); const device = vi.fn(); const zoom = vi.fn();
    render(<PreviewStage
      frame={{ current: null }} frameSrc="/preview/token" sandboxTitle="Preview" device="desktop" route="/" host="site.test"
      pages={[{ id: "home", name: "Home", route: "/" }, { id: "about", name: "About", route: "/about" }]}
      status="ready" selectMode={false} fullScreen={false} theme="light" zoom={100} fit={false} workLabel="Website up to date" canBack canForward={false}
      onBack={vi.fn()} onForward={vi.fn()} onPage={page} onDevice={device} onZoom={zoom} onFit={vi.fn()} onTheme={vi.fn()}
      onSelectMode={vi.fn()} onRefresh={vi.fn()} onFullScreen={vi.fn()}
    />);
    expect(screen.getByRole("button", { name: "Forward" })).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("Page shown in the preview"), { target: { value: "/about" } });
    expect(page).toHaveBeenCalledWith("/about");
    fireEvent.click(screen.getByRole("button", { name: "Phone" }));
    expect(device).toHaveBeenCalledWith("mobile");
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(zoom).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "More preview options" }));
    expect(screen.getByRole("menuitem", { name: /Open in a new tab/ })).toBeDefined();
    // Preview state is announced in plain words, not as a spinner alone.
    expect(screen.getByRole("status").textContent).toContain("up to date");
  });

  it("keeps fit from shrinking the website below reading size", () => {
    // 520px of canvas cannot show a 1440px desktop frame whole: fitting it
    // exactly produced 34%, which is a picture of a page rather than a page.
    class Narrow { observe() {} disconnect() {} }
    vi.stubGlobal("ResizeObserver", Narrow);
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 520 });
    render(<PreviewStage
      frame={{ current: null }} frameSrc="/preview/token" sandboxTitle="Preview" device="desktop" route="/" host="site.test"
      pages={[{ id: "home", name: "Home", route: "/" }]}
      status="ready" selectMode={false} fullScreen={false} theme="light" zoom={100} fit workLabel="Website up to date"
      canBack={false} canForward={false}
      onBack={vi.fn()} onForward={vi.fn()} onPage={vi.fn()} onDevice={vi.fn()} onZoom={vi.fn()} onFit={vi.fn()} onTheme={vi.fn()}
      onSelectMode={vi.fn()} onRefresh={vi.fn()} onFullScreen={vi.fn()}
    />);
    const zoom = screen.getByRole("button", { name: /Fit stops at/ });
    expect(Number(zoom.textContent?.replace("%", ""))).toBeGreaterThanOrEqual(60);
    // And it says what to do about the part that no longer fits.
    expect(zoom.getAttribute("title")).toContain("Tablet");
    Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
  });

  it("says the same thing about the work as the rest of the workspace", () => {
    render(<PreviewStage
      frame={{ current: null }} frameSrc="/preview/token" sandboxTitle="Preview" device="desktop" route="/" host="site.test"
      pages={[{ id: "home", name: "Home", route: "/" }]}
      status="ready" selectMode={false} fullScreen={false} theme="light" zoom={100} fit={false} workLabel="Building your website…" building
      canBack={false} canForward={false}
      onBack={vi.fn()} onForward={vi.fn()} onPage={vi.fn()} onDevice={vi.fn()} onZoom={vi.fn()} onFit={vi.fn()} onTheme={vi.fn()}
      onSelectMode={vi.fn()} onRefresh={vi.fn()} onFullScreen={vi.fn()}
    />);
    // The live region, and the cover over the runtime's "ready to be built"
    // placeholder, both carry the phase the status bar is showing.
    for (const region of screen.getAllByRole("status")) expect(region.textContent).toContain("Building your website");
    expect(screen.getByRole("heading", { name: "Building your website…" })).toBeDefined();
  });

  it("offers a way to start when the website has no pages", () => {
    render(<PreviewStage
      frame={{ current: null }} frameSrc="/preview/token" sandboxTitle="Preview" device="desktop" route="/" host="site.test"
      pages={[]} status="ready" selectMode={false} fullScreen={false} theme="light" zoom={100} workLabel="Website up to date" fit
      canBack={false} canForward={false}
      empty={<><h2>This website has no pages yet</h2><button type="button">Create your first page</button></>}
      onBack={vi.fn()} onForward={vi.fn()} onPage={vi.fn()} onDevice={vi.fn()} onZoom={vi.fn()} onFit={vi.fn()} onTheme={vi.fn()}
      onSelectMode={vi.fn()} onRefresh={vi.fn()} onFullScreen={vi.fn()}
    />);
    // Not the generated site's own 404, which tells the reader they are lost
    // rather than that they have not started.
    expect(screen.getByRole("heading", { name: "This website has no pages yet" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Create your first page" })).toBeDefined();
  });
});
