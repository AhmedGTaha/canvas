/** @vitest-environment jsdom */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CommandPalette } from "./command-palette";
import type { WorkspaceCommand } from "@/domain/commands/types";
beforeAll(() => { HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); }; HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); }; });
afterEach(() => { cleanup(); run.mockClear(); localStorage.clear(); });
const run = vi.fn();
const commands: WorkspaceCommand[] = [
  { id: "disabled", label: "Archive", category: "Project", icon: "x", permitted: true, availability: { available: false, reason: "Only the owner can archive." }, run },
  { id: "media", label: "Media", description: "Upload images", category: "Assets", icon: "images", permitted: true, availability: { available: true }, shortcut: "M", run },
];
describe("command palette", () => { it("navigates by keyboard, executes valid results, and restores focus", async () => { const close = vi.fn(); const before = document.createElement("button"); document.body.append(before); before.focus(); render(<CommandPalette projectId="p" open commands={commands} pages={[{ id: "page", name: "Contact", slug: "contact", routePath: "/contact", type: "page" }]} onClose={close} onPage={vi.fn()} />); await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Search commands and pages"))); fireEvent.change(screen.getByLabelText("Search commands and pages"), { target: { value: "media" } }); fireEvent.keyDown(screen.getByLabelText("Search commands and pages"), { key: "Enter" }); expect(run).toHaveBeenCalled(); expect(close).toHaveBeenCalled(); await waitFor(() => expect(document.activeElement).toBe(before)); before.remove(); }); it("shows disabled reasons and never executes a disabled result", async () => { render(<CommandPalette projectId="p" open commands={commands} pages={[]} onClose={vi.fn()} onPage={vi.fn()} />); const input = screen.getByLabelText("Search commands and pages"); fireEvent.change(input, { target: { value: "archive" } }); expect(screen.getByText("Only the owner can archive.")).toBeDefined(); fireEvent.keyDown(input, { key: "Enter" }); expect(run).not.toHaveBeenCalled(); }); });
