/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useCallback, useState } from "react";
import { HistoryControls, type HistoryApi, type HistoryTarget } from "./history-controls";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

beforeEach(() => {
  // HistoryControls loads undo/redo state on mount.
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ undo: { id: "u1", summary: "Created Home" }, redo: null, history: [] }), { status: 200, headers: { "Content-Type": "application/json" } })));
});

/**
 * Mirrors how the workspace consumes the published API: the API lands in state,
 * which re-renders the host, which re-renders HistoryControls, which republishes.
 * That round trip is a render loop unless both sides hold their identities.
 */
function Host({ onRender, target, stable }: { onRender: () => void; target: HistoryTarget; stable: boolean }) {
  const [, setApi] = useState<HistoryApi | null>(null);
  onRender();

  const publish = useCallback((api: HistoryApi) => {
    setApi((current) => (current && same(current, api) ? current : api));
  }, []);

  const onChanged = useCallback(() => undefined, []);
  return <HistoryControls
    projectId="p1"
    target={target}
    // The unstable variant is exactly the bug: a fresh arrow every render.
    onChanged={stable ? onChanged : () => undefined}
    showCheckpoints
    hideTrigger
    onApi={publish}
  />;
}

function same(a: HistoryApi, b: HistoryApi) {
  return a.canUndo === b.canUndo && a.canRedo === b.canRedo && a.undoLabel === b.undoLabel
    && a.redoLabel === b.redoLabel && a.busy === b.busy && a.undo === b.undo && a.redo === b.redo
    && a.openVersions === b.openVersions && a.openCheckpoints === b.openCheckpoints;
}

const TARGET: HistoryTarget = { kind: "page", id: "page-1", name: "Home" };

describe("published History API", () => {
  it("settles instead of re-rendering forever", async () => {
    let renders = 0;
    await act(async () => { render(<Host onRender={() => { renders += 1; }} target={TARGET} stable />); });
    // Mount, plus the render that accepts the published API, plus the state load.
    // The bug produced hundreds before React bailed out.
    expect(renders).toBeLessThanOrEqual(6);
  });

  it("holds identity when nothing meaningful changed, even with churning props", async () => {
    let renders = 0;
    // A caller that recreates its callbacks every render must still converge,
    // because the guard rejects an equivalent republish.
    await act(async () => { render(<Host onRender={() => { renders += 1; }} target={TARGET} stable={false} />); });
    expect(renders).toBeLessThanOrEqual(12);
  });

  it("reports the real undo state and label", async () => {
    let latest: HistoryApi | null = null;
    function Capture() {
      const publish = useCallback((api: HistoryApi) => { latest = api; }, []);
      return <HistoryControls projectId="p1" target={TARGET} onChanged={() => undefined} hideTrigger onApi={publish} />;
    }
    await act(async () => { render(<Capture />); });
    // The initial state load is deferred behind a 0ms timer, so the first
    // publish happens before it lands; wait for the macrotask.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(latest!.canUndo).toBe(true);
    expect(latest!.undoLabel).toBe("Undo: Created Home");
    expect(latest!.canRedo).toBe(false);
    expect(latest!.redoLabel).toBe("Nothing to redo");
  });

  it("renders no visible controls when the host supplies its own chrome", async () => {
    const { container } = await act(async () => render(<Host onRender={() => undefined} target={TARGET} stable />));
    expect(container.querySelector(".history-controls")).toBeNull();
    // The History dialog still has to exist — the status bar opens it.
    expect(container.querySelector("dialog")).not.toBeNull();
  });
});
