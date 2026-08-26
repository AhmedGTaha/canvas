// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CodeView } from "./code-view";

afterEach(cleanup);

describe("Code View", () => {
  it("shows the active page's HTML, CSS and JavaScript read-only and never as an editor", () => {
    render(<CodeView pageName="Home" html={'<main data-canvas-id="hero">Hi</main>'} css=".x{color:red}" js="console.log(1)" title="Home" description="A page" />);
    // The source is presented in a non-editable region — no textarea, no contenteditable.
    expect(document.querySelector("textarea")).toBeNull();
    expect(document.querySelector("[contenteditable]")).toBeNull();
    expect(screen.getByRole("tablist", { name: "Generated source" })).toBeDefined();
    // HTML is shown first.
    expect(screen.getByText(/data-canvas-id/)).toBeDefined();
    // Switching tabs reveals CSS.
    fireEvent.click(screen.getByRole("tab", { name: /CSS/ }));
    expect(screen.getByText(/color:red/)).toBeDefined();
  });

  it("offers no editing affordance and states when a section is empty", () => {
    render(<CodeView pageName="Contact" html={'<main data-canvas-id="c">Hi</main>'} css="" js="" title={null} description={null} />);
    fireEvent.click(screen.getByRole("tab", { name: /JavaScript/ }));
    expect(screen.getByText("This page uses no JavaScript.")).toBeDefined();
    // No save control exists anywhere in the view.
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
  });

  it("shows an empty state for an unbuilt page", () => {
    render(<CodeView pageName="About" html={null} css={null} js={null} title={null} description={null} />);
    expect(screen.getByText("No code yet")).toBeDefined();
    expect(document.querySelector("pre")).toBeNull();
  });
});
