import { describe, expect, it, vi } from "vitest";
import { createWorkspaceCommands } from "./registry";
import { fuzzyScore, searchWorkspace } from "./search";

function commands(overrides: { hasPage?: boolean } = {}) { const noop = vi.fn(); return createWorkspaceCommands({ canManageProject: false, hasPage: false, hasSelection: false, activeWork: true, canUndo: false, canRedo: true, explorerOpen: true, agentOpen: false, openPanel: noop, openPalette: noop, openTasks: noop, openHistory: noop, openCheckpoints: noop, openWebsite: noop, openAssets: noop, openDesign: noop, openSections: noop, newPage: noop, newFolder: noop, viewCode: noop, navigate: noop, toggleExplorer: noop, toggleAgent: noop, undo: noop, redo: noop, setTheme: noop, setDevice: noop, refreshPreview: noop, toggleFullScreen: noop, signOut: noop, ...overrides }); }

describe("workspace command registry and search", () => {
  it("ranks exact, prefix, token, and fuzzy matches deterministically", () => { expect(fuzzyScore("media", "Media")).toBeGreaterThan(fuzzyScore("media", "Open media library")); expect(fuzzyScore("bld blks", "Building Blocks")).toBeGreaterThan(0); expect(fuzzyScore("xyz", "Media")).toBe(0); });
  it("finds synonyms and project-scoped page routes", () => { const results = searchWorkspace("uploads", commands(), [{ id: "p1", name: "Work", slug: "work", routePath: "/portfolio/work", type: "page" }]); expect(results[0]?.type).toBe("command"); expect(results[0]?.key).toBe("command:assets.media"); expect(searchWorkspace("/portfolio", commands(), [{ id: "p1", name: "Work", slug: "work", routePath: "/portfolio/work", type: "page" }])[0]?.key).toBe("page:p1"); });
  it("shows the most useful commands first when nothing has been typed", () => {
    const results = searchWorkspace("", commands(), [{ id: "p1", name: "Work", slug: "work", routePath: "/work", type: "page" }]);
    // Every score is equal on an empty query, so the tiebreak decides the whole
    // list. Sorting by key put Account, Keyboard shortcuts and Sign out at the
    // top of a palette that is opened to do something to the website.
    expect(results[0]?.key).toBe("command:navigation.palette");
    const accountAt = results.findIndex((result) => result.key === "command:account.sign-out");
    const pagesAt = results.findIndex((result) => result.key === "command:pages.new");
    expect(pagesAt).toBeLessThan(accountAt);
    // Pages come after commands at equal score.
    expect(results.at(-1)?.key).toBe("page:p1");
  });

  it("exposes a read-only View code command that needs an active page", () => {
    expect(commands().find((item) => item.id === "preview.code")).toMatchObject({ label: "View code", availability: { available: false, reason: "Select a page first." } });
    expect(commands({ hasPage: true }).find((item) => item.id === "preview.code")?.availability).toEqual({ available: true });
  });

  it("carries categories, shortcuts, disabled reasons, and permission filtering", () => { const registry = commands(); expect(registry.find((item) => item.id === "agent.toggle")).toMatchObject({ category: "Agent", shortcut: "Ctrl / ⌘ + J" }); expect(registry.find((item) => item.id === "history.undo")?.availability).toEqual({ available: false, reason: "There is nothing to undo." }); expect(searchWorkspace("secret", [{ ...registry[0]!, id: "secret", label: "Secret", permitted: false }], [])).toEqual([]); });
});
