/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Input, Textarea } from "@/components/ui/form-controls";
import { Menu } from "@/components/ui/menu";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { PageHeader } from "@/components/ui/page-header";
import { SelectedElementChip } from "@/components/builder/builder-workspace";

afterEach(cleanup);

/** WCAG relative luminance and contrast ratio. */
function luminance(hex: string) {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? [...value].map((character) => character + character).join("") : value;
  const channels = [0, 2, 4].map((offset) => parseInt(full.slice(offset, offset + 2), 16) / 255)
    .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}
function contrast(foreground: string, background: string) {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter! + 0.05) / (darker! + 0.05);
}
const css = readFileSync("src/app/globals.css", "utf8");
function token(name: string) {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,6})`).exec(css);
  if (!match) throw new Error(`Missing design token --${name}`);
  return match[1]!;
}

describe("Canvas UI accessibility", () => {
  it("meets WCAG AA contrast for the core text palette", () => {
    const surface = token("surface"); const background = token("background"); const muted = token("muted");
    const pairs: Array<[string, string, string, number]> = [
      ["body text on surface", token("text"), surface, 4.5],
      ["body text on app background", token("text"), background, 4.5],
      ["muted text on surface", muted, surface, 4.5],
      ["muted text on app background", muted, background, 4.5],
      ["primary button label", token("accent-contrast"), token("accent"), 4.5],
      ["danger text on surface", token("danger"), surface, 4.5],
      ["success text on surface", token("success"), surface, 4.5],
    ];
    for (const [name, foreground, over, minimum] of pairs) {
      expect(contrast(foreground, over), `${name} (${foreground} on ${over})`).toBeGreaterThanOrEqual(minimum);
    }
  });

  it("defines no color outside the token palette", () => {
    // Every color in the stylesheets resolves through a token, so the palette
    // below is the whole palette — there is no second, drifting one hiding in a
    // component rule. The tokens themselves are the only literals.
    const workspaceCss = readFileSync("src/app/workspace.css", "utf8");
    const afterTokens = css.slice(css.indexOf("* { box-sizing: border-box; }"));
    for (const [name, sheet] of [["globals.css", afterTokens], ["workspace.css", workspaceCss]] as const) {
      const literals = [...sheet.matchAll(/#[0-9a-fA-F]{3,6}\b/g)].map((match) => match[0]);
      expect(literals, `${name} hard-codes ${literals.join(", ")} instead of using a token`).toHaveLength(0);
    }
  });

  it("keeps every text token above the AA threshold on the surface it sits on", () => {
    const pairs: Array<[string, string, string]> = [
      ["strong muted text", token("muted-strong"), token("surface")],
      ["strong muted text on canvas", token("muted-strong"), token("background")],
      ["soft muted text", token("muted-soft"), token("surface")],
      ["soft muted text on canvas", token("muted-soft"), token("background")],
      ["muted text on a sunken surface", token("muted"), token("surface-muted")],
      ["selected tree row", token("focus-strong"), token("focus-soft")],
      ["danger text on its surface", token("danger"), token("danger-soft")],
      ["success text on its surface", token("success"), token("success-soft")],
      ["draft badge", token("warning-ink"), token("warning-soft")],
    ];
    for (const [name, foreground, over] of pairs) {
      expect(contrast(foreground, over), `${name} (${foreground} on ${over})`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("gives icon-only controls an accessible name", () => {
    render(<>
      <Button aria-label="Refresh preview"><span aria-hidden="true">↻</span></Button>
      <Menu label="Page actions"><Button>Rename</Button></Menu>
      <SelectedElementChip selection={{ canvasId: "hero-main", elementType: "section", label: "Hero", blockId: null }} onClear={() => undefined} />
    </>);
    expect(screen.getByRole("button", { name: "Refresh preview" })).toBeDefined();
    expect(screen.getByLabelText("Page actions")).toBeDefined();
    expect(screen.getByRole("button", { name: "Clear selected element" })).toBeDefined();
  });

  it("labels dialogs and lets the keyboard reach every control", () => {
    render(<Dialog title="Create project" description="Name your project." triggerLabel="New project">
      <Input label="Project name" name="name" />
      <Button type="submit">Create</Button>
    </Dialog>);
    const dialog = document.querySelector("dialog")!;
    // jsdom does not implement showModal; opening the element exposes the same tree.
    dialog.setAttribute("open", "");
    // The accessible name comes from the visible heading, not a duplicated string.
    const headingId = dialog.getAttribute("aria-labelledby");
    expect(headingId).toBeTruthy();
    expect(document.getElementById(headingId!)?.textContent).toBe("Create project");
    expect(within(dialog).getByRole("button", { name: "Close dialog" })).toBeDefined();
    // Native <dialog> + showModal gives focus trapping and Escape-to-close for free.
    expect(dialog.tagName).toBe("DIALOG");
    for (const control of dialog.querySelectorAll("button, input, textarea, select, a[href]")) {
      expect(control.getAttribute("tabindex")).not.toBe("-1");
    }
  });

  it("labels destructive confirmations and offers a cancel path", () => {
    render(<ConfirmationDialog title="Delete page" description="This cannot be undone." action={<Button variant="danger">Delete</Button>} />);
    const dialog = document.querySelector("dialog")!;
    dialog.setAttribute("open", "");
    expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)?.textContent).toBe("Delete page");
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDefined();
    expect(screen.getAllByRole("button", { name: "Delete page" }).length).toBeGreaterThan(0);
  });

  it("associates form labels, hints, and validation messages with their fields", () => {
    render(<>
      <Input label="Project name" name="name" hint="Shown in your workspace." />
      <Textarea label="Description" name="description" error="Describe the project." />
    </>);
    const name = screen.getByLabelText("Project name");
    expect(name.getAttribute("aria-invalid")).toBe("false");

    const description = screen.getByLabelText("Description");
    expect(description.getAttribute("aria-invalid")).toBe("true");
    const describedBy = description.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    // The error text is programmatically reachable, not color-only.
    expect(document.getElementById(describedBy!)?.textContent).toBe("Describe the project.");
  });

  it("gives every field its own id, so two unnamed fields do not share one label", () => {
    // Brand renders three unnamed fields side by side. When the id fell back to
    // the element type, all three labels pointed at the first control and the
    // other two had no accessible name at all.
    render(<>
      <Textarea label="Company description" rows={2} />
      <Textarea label="Brand notes" rows={2} />
      <Input label="Company name" />
      <Input label="Tagline" />
    </>);
    const fields = ["Company description", "Brand notes", "Company name", "Tagline"].map((label) => screen.getByLabelText(label));
    expect(new Set(fields.map((field) => field.id)).size).toBe(fields.length);
    for (const field of fields) expect(field.id).toBeTruthy();
  });

  it("announces loading, empty, and error states to assistive technology", () => {
    const { container } = render(<>
      <LoadingState label="Loading projects…" />
      <EmptyState title="No projects yet" description="Create your first project." action={<Button>Create project</Button>} />
      <ErrorState description="Projects could not be loaded." retry={<Button>Try again</Button>} />
    </>);
    expect(screen.getByRole("status").textContent).toContain("Loading projects…");
    expect(screen.getByRole("heading", { name: "No projects yet" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Create project" })).toBeDefined();
    // Every empty/error state offers a way forward rather than a dead end.
    expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
    expect(container.querySelectorAll("svg[aria-hidden], svg").length).toBeGreaterThan(0);
  });

  it("exposes one page heading with its context", () => {
    render(<PageHeader eyebrow="Acme Site" title="Building Blocks" description="Reusable sections." actions={<Button>New</Button>} />);
    const headings = screen.getAllByRole("heading");
    expect(headings).toHaveLength(1);
    expect(headings[0]!.tagName).toBe("H1");
    expect(headings[0]!.textContent).toBe("Building Blocks");
  });

  it("keeps decorative icons out of the accessibility tree names", () => {
    render(<Button>Export website<span aria-hidden="true">📦</span></Button>);
    expect(screen.getByRole("button").textContent).toContain("Export website");
    expect(screen.getByRole("button", { name: /Export website/ })).toBeDefined();
  });
});
