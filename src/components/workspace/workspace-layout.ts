export const WORKSPACE_ACTIVITIES = ["website", "assets", "design", "sections", "history"] as const;
export type WorkspaceActivity = (typeof WORKSPACE_ACTIVITIES)[number];
export type WorkspaceBreakpoint = "desktop" | "compact" | "mobile";
export type MobileSurface = "tools" | "preview" | "agent";
export type WorkspaceLayout = { primary: boolean; agent: boolean; primaryWidth: number; agentWidth: number; activity: WorkspaceActivity; mobileSurface: MobileSurface; zoom: number; fit: boolean };

/**
 * Pane sizing.
 *
 * The Preview is the workspace, not one panel of three. The defaults below are the
 * narrowest widths at which each sidebar still does its job — the explorer at 240px
 * holds a page name plus its row actions without truncating, and the agent at 344px
 * keeps a readable message measure — so everything left over belongs to the website.
 * At 1440px that is 812px of stage against 716px before, and the handles still reach
 * the old widths for anyone who wants them.
 */
/** Mirrors `--ws-activity-w`; the only fixed chrome column beside the two panes. */
export const ACTIVITY_BAR_WIDTH = 48;
export const PRIMARY_PANE_RANGE = [200, 400] as const;
export const AGENT_PANE_RANGE = [300, 560] as const;
export const DEFAULT_WORKSPACE_LAYOUT: WorkspaceLayout = { primary: true, agent: true, primaryWidth: 240, agentWidth: 344, activity: "website", mobileSurface: "preview", zoom: 100, fit: true };

export function breakpointFor(width: number): WorkspaceBreakpoint { return width < 768 ? "mobile" : width < 1280 ? "compact" : "desktop"; }
export function isWorkspaceActivity(value: unknown): value is WorkspaceActivity { return typeof value === "string" && (WORKSPACE_ACTIVITIES as readonly string[]).includes(value); }
export function normalizeWorkspaceLayout(value: Partial<WorkspaceLayout>, breakpoint: WorkspaceBreakpoint): WorkspaceLayout {
  const merged = { ...DEFAULT_WORKSPACE_LAYOUT, ...value };
  const layout: WorkspaceLayout = { ...merged, activity: isWorkspaceActivity(merged.activity) ? merged.activity : "website", primaryWidth: Math.min(PRIMARY_PANE_RANGE[1], Math.max(PRIMARY_PANE_RANGE[0], Number(merged.primaryWidth) || DEFAULT_WORKSPACE_LAYOUT.primaryWidth)), agentWidth: Math.min(AGENT_PANE_RANGE[1], Math.max(AGENT_PANE_RANGE[0], Number(merged.agentWidth) || DEFAULT_WORKSPACE_LAYOUT.agentWidth)), zoom: Math.min(150, Math.max(50, Number(merged.zoom) || 100)), mobileSurface: ["tools", "preview", "agent"].includes(merged.mobileSurface) ? merged.mobileSurface : "preview" };
  if (breakpoint === "compact" && layout.agent) layout.primary = false;
  if (breakpoint === "mobile") { layout.primary = layout.mobileSurface === "tools"; layout.agent = layout.mobileSurface === "agent"; }
  return layout;
}
