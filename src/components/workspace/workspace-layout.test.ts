import { describe, expect, it } from "vitest";
import { ACTIVITY_BAR_WIDTH, AGENT_PANE_RANGE, breakpointFor, DEFAULT_WORKSPACE_LAYOUT, normalizeWorkspaceLayout, PRIMARY_PANE_RANGE } from "./workspace-layout";

describe("responsive workspace state", () => {
  it("classifies approved breakpoints", () => { expect(breakpointFor(1440)).toBe("desktop"); expect(breakpointFor(1024)).toBe("compact"); expect(breakpointFor(768)).toBe("compact"); expect(breakpointFor(767)).toBe("mobile"); expect(breakpointFor(390)).toBe("mobile"); });
  it("normalizes compact layouts so the agent does not squeeze three columns", () => { expect(normalizeWorkspaceLayout({ primary: true, agent: true }, "compact")).toMatchObject({ primary: false, agent: true }); });
  it("enforces one focused mobile surface", () => { expect(normalizeWorkspaceLayout({ mobileSurface: "tools", primary: false, agent: true }, "mobile")).toMatchObject({ mobileSurface: "tools", primary: true, agent: false }); expect(normalizeWorkspaceLayout({ mobileSurface: "agent", primary: true, agent: false }, "mobile")).toMatchObject({ primary: false, agent: true }); expect(normalizeWorkspaceLayout({ mobileSurface: "preview", primary: true, agent: true }, "mobile")).toMatchObject({ primary: false, agent: false }); });
  it("rejects corrupt persisted dimensions and activities", () => { expect(normalizeWorkspaceLayout({ primaryWidth: 9999, agentWidth: 1, zoom: 400, activity: "bad" as never }, "desktop")).toMatchObject({ primaryWidth: PRIMARY_PANE_RANGE[1], agentWidth: AGENT_PANE_RANGE[0], zoom: 150, activity: "website" }); });

  /* The Preview is the primary surface, so the chrome around it has a budget.
     1440 is the reference desktop width in the approved responsive model. */
  it("leaves the Preview the majority of a 1440px desktop with both panes open", () => {
    const layout = normalizeWorkspaceLayout({}, "desktop");
    const stage = 1440 - (ACTIVITY_BAR_WIDTH + layout.primaryWidth + layout.agentWidth);
    expect(stage).toBeGreaterThan(1440 * 0.55);
  });

  /*
   * The approved responsive model, checked at the widths it names. The Preview must
   * still own a usable stage on a laptop, and the phone stays one surface at a time.
   */
  it("keeps a usable Preview stage at every approved width", () => {
    const stage = (width: number) => {
      const layout = normalizeWorkspaceLayout({}, breakpointFor(width));
      const breakpoint = breakpointFor(width);
      // Below 1280 the agent floats over the stage rather than taking a column of it,
      // so only the explorer is subtracted there — see the compact rules in workspace.css.
      const agentColumn = breakpoint === "desktop" && layout.agent ? layout.agentWidth : 0;
      return width - (ACTIVITY_BAR_WIDTH + (layout.primary ? layout.primaryWidth : 0) + agentColumn);
    };
    // Laptop and tablet: one side pane in the grid at a time, so the stage keeps the
    // majority of the viewport even with the agent floating over part of it.
    for (const width of [1024, 768]) {
      const layout = normalizeWorkspaceLayout({}, breakpointFor(width));
      expect([layout.primary, layout.agent].filter(Boolean).length, `${width} open panes`).toBe(1);
      expect(stage(width), `${width} stage`).toBeGreaterThan(width * 0.5);
    }
    // Phone: the Preview is the whole screen apart from the activity bar.
    const phone = normalizeWorkspaceLayout({}, breakpointFor(390));
    expect(phone.primary).toBe(false);
    expect(phone.agent).toBe(false);
    expect(phone.mobileSurface).toBe("preview");
    expect(stage(390)).toBe(390 - ACTIVITY_BAR_WIDTH);
  });

  it("keeps both sidebars resizable across a usable range", () => {
    expect(PRIMARY_PANE_RANGE[0]).toBeLessThan(DEFAULT_WORKSPACE_LAYOUT.primaryWidth);
    expect(PRIMARY_PANE_RANGE[1]).toBeGreaterThan(DEFAULT_WORKSPACE_LAYOUT.primaryWidth);
    expect(AGENT_PANE_RANGE[0]).toBeLessThan(DEFAULT_WORKSPACE_LAYOUT.agentWidth);
    expect(AGENT_PANE_RANGE[1]).toBeGreaterThan(DEFAULT_WORKSPACE_LAYOUT.agentWidth);
  });
});
