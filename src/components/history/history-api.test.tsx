/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { HistorySidebar, type HistorySection } from "./history-sidebar";
import { CHECKPOINT_NUDGE_AT, shouldSuggestCheckpoint, useHistoryController, type HistoryController } from "./use-history-controller";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const HISTORY = {
  undo: { id: "u1", summary: "Created Home" },
  redo: null,
  history: [
    { id: "c3", operation: "page_modify", summary: "Rewrote the hero", reversible: true, undone: false, actor: "Ada", createdAt: "2026-02-02T10:00:00Z" },
    { id: "c2", operation: "page_generate", summary: "Created Home", reversible: true, undone: false, actor: "Ada", createdAt: "2026-02-01T10:00:00Z" },
  ],
  lastCheckpointAt: "2026-02-01T09:00:00Z",
  pendingChanges: 6,
};
const CHECKPOINTS = { checkpoints: [{ id: "cp1", name: "Before pricing rework", actor: "Ada", createdAt: "2026-02-01T09:00:00Z", pageCount: 4, blockCount: 2 }] };
const VERSIONS = { currentVersionId: "v2", versions: [
  { id: "v2", versionNumber: 2, createdAt: "2026-02-02T10:00:00Z", actor: "Ada", summary: "Rewrote the hero", isCurrent: true },
  { id: "v1", versionNumber: 1, createdAt: "2026-02-01T10:00:00Z", actor: "Ada", summary: null, isCurrent: false },
] };

function json(value: unknown) { return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } }); }

let calls: Array<{ url: string; method: string }>;
beforeEach(() => {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET" });
    if (url.endsWith("/history")) return json(HISTORY);
    if (url.endsWith("/checkpoints")) return json(CHECKPOINTS);
    if (url.endsWith("/versions")) return json(VERSIONS);
    if (url.endsWith("/history/undo")) return json({ source: { summary: "Rewrote the hero" } });
    return json({});
  }));
});

const TARGET = { kind: "page" as const, id: "page-1", name: "Home" };

/** Mirrors how the workspace mounts History: the controller lives in the host,
 *  the sidebar only renders it, and the open section is the host state. */
function Host({ onController }: { onController?: (controller: HistoryController) => void }) {
  const [section, setSection] = useState<HistorySection>(null);
  const controller = useHistoryController({ projectId: "p1", target: TARGET, onChanged: () => undefined, withCheckpoints: true });
  onController?.(controller);
  return <HistorySidebar controller={controller} section={section} onSection={setSection} />;
}

async function mount(onController?: (controller: HistoryController) => void) {
  const view = await act(async () => render(<Host onController={onController} />));
  // The first state load is deferred behind a 0ms timer.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  return view;
}

describe("History in the sidebar", () => {
  it("reports the real undo state and label", async () => {
    let latest: HistoryController | null = null;
    await mount((controller) => { latest = controller; });
    expect(latest!.canUndo).toBe(true);
    expect(latest!.undoLabel).toBe("Undo: Created Home");
    expect(latest!.canRedo).toBe(false);
    expect(latest!.redoLabel).toBe("Nothing to redo");
  });

  it("opens no dialog, because History is part of the sidebar now", async () => {
    const { container } = await mount();
    expect(container.querySelector("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Undo: Created Home" })).toBeDefined();
  });

  /*
   * The count comes from the server rather than being counted over the history
   * list in the browser: that list is a capped window, so a busy project would
   * quietly report fewer changes than it really has.
   */
  it("badges Checkpoints with the changes made since the last one", async () => {
    await mount();
    const checkpoints = screen.getByRole("button", { name: /Checkpoints/ });
    // The count lives in the badge and is named there; the line beside it says
    // what the count is about rather than repeating the number.
    const badge = checkpoints.querySelector(".ws-side-badge")!;
    expect(badge.textContent).toBe("6");
    expect(badge.getAttribute("aria-label")).toBe("6 unsaved changes");
    expect(checkpoints.textContent).toContain("Unsaved since your last checkpoint");
    expect(calls.some(({ url }) => url.endsWith("/history"))).toBe(true);
  });

  it("says so plainly when nothing is pending", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => json(url.endsWith("/history") ? { ...HISTORY, pendingChanges: 0 } : {})));
    await mount();
    const checkpoints = screen.getByRole("button", { name: /Checkpoints/ });
    expect(checkpoints.querySelector(".ws-side-badge")).toBeNull();
    expect(checkpoints.textContent).toContain("Everything is saved in a checkpoint");
  });

  it("expands each section in place and loads it only when opened", async () => {
    await mount();
    expect(calls.some(({ url }) => url.endsWith("/versions"))).toBe(false);

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Recent changes/ })); });
    expect(screen.getByRole("button", { name: /Recent changes/ }).getAttribute("aria-expanded")).toBe("true");
    expect(calls.some(({ url }) => url.endsWith("/pages/page-1/versions"))).toBe(true);
    expect(screen.getByText("Version 2 · Active")).toBeDefined();

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Checkpoints/ })); });
    expect(calls.some(({ url }) => url.endsWith("/checkpoints"))).toBe(true);
    expect(screen.getByText("Before pricing rework")).toBeDefined();
    // Opening one section closes the other: the sidebar is narrow.
    expect(screen.getByRole("button", { name: /Recent changes/ }).getAttribute("aria-expanded")).toBe("false");

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Checkpoints/ })); });
    expect(screen.getByRole("button", { name: /Checkpoints/ }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Before pricing rework")).toBeNull();
  });

  it("restores an earlier version from the sidebar and reports what happened", async () => {
    await mount();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Recent changes/ })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Restore" })); });
    expect(calls).toContainEqual({ url: "/api/projects/p1/pages/page-1/versions/v1/restore", method: "POST" });
    expect(screen.getByRole("status").textContent).toContain("Restored version 1.");
  });

  it("saves a checkpoint from the sidebar", async () => {
    await mount();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Checkpoints/ })); });
    fireEvent.change(screen.getByLabelText("Checkpoint name"), { target: { value: "Before rework" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Save checkpoint/ })); });
    expect(calls.some(({ url, method }) => url.endsWith("/checkpoints") && method === "POST")).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("Checkpoint saved.");
  });

  it("undoes from the sidebar header without leaving it", async () => {
    const { container } = await mount();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Undo: Created Home" })); });
    expect(calls).toContainEqual({ url: "/api/projects/p1/history/undo", method: "POST" });
    expect(container.querySelector("dialog")).toBeNull();
  });
});

describe("suggesting a checkpoint", () => {
  it("stays quiet until enough work has piled up", () => {
    expect(shouldSuggestCheckpoint(0, 0)).toBe(false);
    expect(shouldSuggestCheckpoint(CHECKPOINT_NUDGE_AT - 1, 0)).toBe(false);
    expect(shouldSuggestCheckpoint(CHECKPOINT_NUDGE_AT, 0)).toBe(true);
  });

  it("buys another full threshold of silence when dismissed, not silence for ever", () => {
    const dismissedAt = CHECKPOINT_NUDGE_AT;
    expect(shouldSuggestCheckpoint(dismissedAt, dismissedAt)).toBe(false);
    expect(shouldSuggestCheckpoint(dismissedAt + CHECKPOINT_NUDGE_AT - 1, dismissedAt)).toBe(false);
    expect(shouldSuggestCheckpoint(dismissedAt + CHECKPOINT_NUDGE_AT, dismissedAt)).toBe(true);
    // Saving a checkpoint clears the count, and with it the suggestion.
    expect(shouldSuggestCheckpoint(0, dismissedAt)).toBe(false);
  });
});
