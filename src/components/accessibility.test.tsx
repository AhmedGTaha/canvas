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
/*
 * Tokens are read from the token layer and resolved through their aliases, so
 * a colour that is defined once and referenced by five semantic names is still
 * checked as the colour it actually renders as.
 */
const tokenCss = readFileSync("src/app/tokens.css", "utf8");
const styleSheets = ["base", "ui", "app", "workspace", "panels"].map((name) => [`${name}.css`, readFileSync(`src/app/${name}.css`, "utf8")] as const);

type Appearance = "light" | "dark";

/*
 * Resolves a token the way the browser does, in one appearance at a time.
 *
 * A semantic token is written once as `light-dark(light, dark)`, so the same
 * name has two real values and both have to hold up. Picking the arm here — and
 * following aliases in the same appearance — is what lets every contrast check
 * below run twice over one list of pairs instead of being written out twice and
 * drifting.
 */
function token(name: string, appearance: Appearance, seen = new Set<string>()): string {
  if (seen.has(name)) throw new Error(`Design token --${name} refers to itself`);
  seen.add(name);
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(tokenCss);
  if (!match) throw new Error(`Missing design token --${name}`);
  const value = match[1]!.trim();
  const pair = lightDarkArms(value);
  const resolved = pair ? pair[appearance === "light" ? 0 : 1]! : value;
  const alias = /^var\((--[\w-]+)\)$/.exec(resolved);
  if (alias) return token(alias[1]!.slice(2), appearance, seen);
  if (!/^#[0-9a-fA-F]{3,6}$/.test(resolved)) throw new Error(`Design token --${name} is not a colour in ${appearance}: ${resolved}`);
  return resolved;
}

/** Splits `light-dark(a, b)` at the comma that separates its two arms — its arms contain commas of their own. */
function lightDarkArms(value: string): [string, string] | null {
  if (!value.startsWith("light-dark(") || !value.endsWith(")")) return null;
  const inner = value.slice("light-dark(".length, -1);
  let depth = 0;
  for (let index = 0; index < inner.length; index += 1) {
    const character = inner[index];
    if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    else if (character === "," && depth === 0) return [inner.slice(0, index).trim(), inner.slice(index + 1).trim()];
  }
  throw new Error(`light-dark() with one arm: ${value}`);
}

const APPEARANCES: Appearance[] = ["light", "dark"];

describe("Canvas UI accessibility", () => {
  it.each(APPEARANCES)("meets WCAG AA contrast for the core text palette in %s", (appearance) => {
    const at = (name: string) => token(name, appearance);
    const surface = at("surface"); const app = at("surface-app"); const muted = at("text-muted");
    const pairs: Array<[string, string, string, number]> = [
      ["body text on surface", at("text"), surface, 4.5],
      ["body text on the app background", at("text"), app, 4.5],
      ["muted text on surface", muted, surface, 4.5],
      ["muted text on the app background", muted, app, 4.5],
      ["primary button label", at("accent-contrast"), at("accent"), 4.5],
      ["danger text on surface", at("danger"), surface, 4.5],
      ["success text on surface", at("success"), surface, 4.5],
      ["accent on chrome", at("focus"), at("surface-chrome"), 4.5],
    ];
    for (const [name, foreground, over, minimum] of pairs) {
      expect(contrast(foreground, over), `${name} in ${appearance} (${foreground} on ${over})`).toBeGreaterThanOrEqual(minimum);
    }
  });

  it("defines no color outside the token palette", () => {
    // Every color in the stylesheets resolves through a token, so the palette
    // below is the whole palette — there is no second, drifting one hiding in a
    // component rule. The tokens themselves are the only literals.
    for (const [name, sheet] of styleSheets) {
      const literals = [...sheet.matchAll(/#[0-9a-fA-F]{3,6}\b/g)].map((match) => match[0]);
      expect(literals, `${name} hard-codes ${literals.join(", ")} instead of using a token`).toHaveLength(0);
    }
  });

  it.each(APPEARANCES)("keeps every text token above the AA threshold on the surface it sits on in %s", (appearance) => {
    const at = (name: string) => token(name, appearance);
    const pairs: Array<[string, string, string]> = [
      ["secondary text", at("text-secondary"), at("surface")],
      ["secondary text on the app background", at("text-secondary"), at("surface-app")],
      ["subtle text", at("text-subtle"), at("surface")],
      ["subtle text on the app background", at("text-subtle"), at("surface-app")],
      ["muted text on a muted surface", at("text-muted"), at("surface-muted")],
      ["muted text on a hovered row", at("text-muted"), at("surface-hover")],
      ["body text in a field", at("text"), at("surface-field")],
      ["a placeholder in a field", at("text-subtle"), at("surface-field")],
      ["muted text on the preview mat", at("text-muted"), at("surface-sunken")],
      ["muted text on chrome", at("text-muted"), at("surface-chrome")],
      ["subtle text on chrome", at("text-subtle"), at("surface-chrome")],
      ["selected row", at("focus-strong"), at("surface-selected")],
      ["tooltip label", at("tooltip-text"), at("tooltip-surface")],
      ["danger text on its surface", at("danger"), at("danger-soft")],
      ["success text on its surface", at("success"), at("success-soft")],
      ["draft badge", at("warning"), at("warning-soft")],
    ];
    for (const [name, foreground, over] of pairs) {
      expect(contrast(foreground, over), `${name} in ${appearance} (${foreground} on ${over})`).toBeGreaterThanOrEqual(4.5);
    }
  });

  /*
   * Selection, focus and control edges are not text, so AA does not apply to
   * them — but they are the marks that say "this is the thing you are editing"
   * and "this is a control", and at 1.2:1 on a dark backdrop they simply are not
   * there. 3:1 is the non-text threshold, held in both appearances.
   */
  it.each(APPEARANCES)("keeps non-text indicators visible in %s", (appearance) => {
    const at = (name: string) => token(name, appearance);
    const pairs: Array<[string, string, string]> = [
      ["the focus ring on the app background", at("focus"), at("surface-app")],
      ["the focus ring on chrome", at("focus"), at("surface-chrome")],
      ["the focus ring on the preview mat", at("focus"), at("surface-sunken")],
      ["the selection spine", at("focus"), at("surface-selected")],
    ];
    for (const [name, foreground, over] of pairs) {
      expect(contrast(foreground, over), `${name} in ${appearance} (${foreground} on ${over})`).toBeGreaterThanOrEqual(3);
    }
  });

  /*
   * The edge of a control — an input's border, a switch's track — is the only
   * thing saying it is a control, and a hairline that survives on paper can
   * vanish entirely on a dark surface. Dark is held to 3:1 outright. Light is
   * held to "no worse than it already was", because raising the paper hairline
   * to 3:1 would visibly reweight every field in the product, which is a
   * separate decision from adding an appearance.
   */
  it("keeps control edges readable, and never softer in dark than on paper", () => {
    const surfaceFor = (name: string) => (name === "border-strong" ? "surface-field" : "surface");
    for (const name of ["border-strong", "control-track"]) {
      const over = surfaceFor(name);
      const dark = contrast(token(name, "dark"), token(over, "dark"));
      const light = contrast(token(name, "light"), token(over, "light"));
      expect(dark, `--${name} against a dark ${over}`).toBeGreaterThanOrEqual(3);
      expect(dark, `--${name} is softer in dark than in light`).toBeGreaterThanOrEqual(light);
    }
  });

  /*
   * The website in the preview is not Canvas chrome. Its paper stays the paper
   * whatever appearance Canvas is in, which is the whole reason the token is
   * written without a light-dark() pair — this is the check that keeps someone
   * from "finishing" dark mode by flipping it.
   */
  it("never darkens the sheet the user's own website is rendered on", () => {
    expect(token("preview-paper", "light")).toBe(token("preview-paper", "dark"));
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
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeDefined();
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
    render(<PageHeader title="Building Blocks" description="Reusable sections." back={{ href: "/workspaces", label: "Acme Site" }} actions={<Button>New</Button>} />);
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
