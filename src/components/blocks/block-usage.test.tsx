/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BlockLibrary, type BlockSummary } from "./block-library";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const BLOCK: BlockSummary = { id: "block-1", name: "Primary navbar", kind: "navbar", isGlobal: true, currentVersionId: "v1", contentStatus: "generated", currentVersionNumber: 1, usageCount: 2 };
const STARTER_BLOCK: BlockSummary = { id: "block-2", name: "Classic bar", kind: "navbar", isGlobal: false, currentVersionId: "v2", contentStatus: "generated", currentVersionNumber: 1, usageCount: 0 };
const STARTERS = [
  { id: "navbar-classic", category: "navbar" as const, name: "Classic bar", description: "Brand on the left, links and one call to action on the right.", kind: "navbar", interactive: false },
  { id: "hero-statement", category: "hero" as const, name: "Single claim", description: "One headline, one supporting line, one action.", kind: "hero", interactive: false },
];
const USAGES = [
  { usageKey: "site-navbar", pageId: "page-home", pageName: "Home", route: "/", pinnedVersionId: null, resolution: "global" },
  { usageKey: "site-navbar", pageId: "page-about", pageName: "About", route: "/about", pinnedVersionId: "v1", resolution: "pinned" },
];

function json(value: unknown) { return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } }); }

let calls: Array<{ url: string; method: string; body?: unknown }>;
beforeEach(() => {
  calls = [];
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); } },
    close: { configurable: true, value: function close(this: HTMLDialogElement) { this.removeAttribute("open"); } },
  });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.endsWith("/starter-sections")) return init?.method === "POST" ? json({ block: STARTER_BLOCK }) : json({ starters: STARTERS });
    if (url.endsWith("/usages")) return json({ usages: USAGES });
    if (url.endsWith("/ai")) return json({ block: { id: BLOCK.id, currentVersionId: "v1" }, conversation: null, messages: [], job: null });
    if (url.endsWith("/history")) return json({ undo: null, redo: null, history: [], lastCheckpointAt: null, pendingChanges: 0 });
    if (url.endsWith("/blocks")) return json({ blocks: [BLOCK] });
    return json({});
  }));
});

async function mountLibrary(withPreview = false) {
  const view = await act(async () => render(<BlockLibrary
    projectId="p1"
    initialBlocks={[BLOCK]}
    initialSession={withPreview ? { token: "preview-token", expiresAt: "2099-01-01T00:00:00.000Z", manifest: { previewSessionId: "session" } as never } : null}
    initialPreviewError={withPreview ? undefined : "Preview is off in this test."}
    initialInstanceId="instance"
    mediaAssets={[]}
    mediaFolders={[]}
  />));
  await waitFor(() => expect(screen.getByText("Home")).toBeDefined());
  return view;
}

/*
 * "Used on" used to be read-only: the only lever was the block-wide "Share
 * across pages" toggle, so freezing one page's copy meant freezing all of them.
 */
describe("per-page attach and detach in Used on", () => {
  it("offers the opposite action for each page's current resolution", async () => {
    await mountLibrary();
    const rows = [...document.querySelectorAll(".blocks-usage li")];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain("Always current");
    expect(rows[0]!.querySelector("button")!.textContent).toContain("Detach");
    expect(rows[1]!.textContent).toContain("Fixed version");
    expect(rows[1]!.querySelector("button")!.textContent).toContain("Reattach");
  });

  it("freezes one page's copy, naming the page so the other pages are untouched", async () => {
    await mountLibrary();
    await act(async () => { fireEvent.click(screen.getByTitle("Freeze Home at the current version")); });
    const patched = calls.find(({ method }) => method === "PATCH");
    expect(patched?.url).toBe("/api/projects/p1/blocks/block-1/usages/site-navbar");
    // Both pages use the same key, so the page id is what makes this one usage.
    expect(patched?.body).toEqual({ pageId: "page-home", resolution: "pinned" });
    // The list is reloaded rather than guessed at locally.
    expect(calls.filter(({ url }) => url.endsWith("/usages")).length).toBeGreaterThan(1);
  });

  it("puts a frozen page back onto the shared version", async () => {
    await mountLibrary();
    await act(async () => { fireEvent.click(screen.getByTitle("Let About follow the shared section again")); });
    const patched = calls.find(({ method }) => method === "PATCH");
    expect(patched?.body).toEqual({ pageId: "page-about", resolution: "global" });
  });
});

describe("ready-made building blocks", () => {
  it("shows visual choices and updates the preview before adding the selected starter", async () => {
    await mountLibrary(true);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "New" })); });

    const classic = await screen.findByRole("option", { name: /Classic bar/ });
    await waitFor(() => expect(classic.querySelector("iframe")?.getAttribute("src")).toContain("starter=navbar-classic"));
    await act(async () => { fireEvent.click(screen.getByRole("option", { name: /Single claim/ })); });

    expect(screen.getByLabelText("Preview: Single claim")).toBeDefined();
    expect(screen.getByTitle("Single claim preview").getAttribute("src")).toContain("starter=hero-statement");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Use Single claim" })); });
    await waitFor(() => expect(calls).toContainEqual(expect.objectContaining({
      url: "/api/projects/p1/starter-sections", method: "POST", body: { starterId: "hero-statement", isGlobal: false },
    })));
  });
});
