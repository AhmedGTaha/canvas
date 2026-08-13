/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const back = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace, back, refresh: vi.fn() }) }));

const { FeaturePanel } = await import("./feature-panel");
const { notePanelPushed, resetPanelHistory } = await import("./panel-url");

// jsdom implements neither showModal nor close.
beforeEach(() => {
  back.mockClear();
  replace.mockClear();
  resetPanelHistory();
  window.history.replaceState({}, "", "/projects/p?page=home&tool=brand");
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.open = false; };
});
afterEach(cleanup);

function renderPanel() {
  return render(<FeaturePanel title="Brand & design" description="Shared by every page.">
    <p>Body</p>
  </FeaturePanel>);
}

describe("feature panel", () => {
  it("opens as a modal and names itself from its heading", () => {
    const { container } = renderPanel();
    const dialog = container.querySelector("dialog")!;
    expect(dialog.open).toBe(true);
    expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)?.textContent).toBe("Brand & design");
  });

  it("steps back when the workspace opened the tool, so the browser's back button agrees", () => {
    notePanelPushed();
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Close and return to the website" }));
    expect(back).toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("clears the tool from the URL when there is no entry to go back to", () => {
    // A bookmark or a reload lands on ?tool= with no workspace behind it in
    // history; going back would leave the project entirely.
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Close and return to the website" }));
    expect(back).not.toHaveBeenCalled();
    // The previewed page is workspace state, not panel state, and survives.
    expect(replace).toHaveBeenCalledWith("/projects/p?page=home", { scroll: false });
  });

  it("closes on Escape rather than leaving the dialog open", () => {
    const { container } = renderPanel();
    const dialog = container.querySelector("dialog")!;
    fireEvent(dialog, new Event("cancel", { bubbles: false, cancelable: true }));
    expect(dialog.open).toBe(false);
    expect(replace).toHaveBeenCalled();
  });

  it("closes the dialog when unmounted without a close, so the page is never left inert", () => {
    const { container, unmount } = renderPanel();
    const dialog = container.querySelector("dialog")!;
    expect(dialog.open).toBe(true);
    // A link inside the panel navigating away unmounts it with the modal open.
    unmount();
    expect(dialog.open).toBe(false);
  });

  it("uses a scrollable body separate from the fixed header", () => {
    const { container } = renderPanel();
    expect(container.querySelector(".ws-panel-hd")).not.toBeNull();
    expect(container.querySelector(".ws-panel-bd")!.textContent).toContain("Body");
  });
});
