/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const back = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), back, refresh: vi.fn() }) }));

const { FeaturePanel } = await import("./feature-panel");

// jsdom implements neither showModal nor close.
beforeEach(() => {
  back.mockClear();
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

  it("returns to the workspace from the close button", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Close and return to the website" }));
    expect(back).toHaveBeenCalled();
  });

  it("closes on Escape rather than leaving the dialog open", () => {
    const { container } = renderPanel();
    const dialog = container.querySelector("dialog")!;
    fireEvent(dialog, new Event("cancel", { bubbles: false, cancelable: true }));
    expect(dialog.open).toBe(false);
    expect(back).toHaveBeenCalled();
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
