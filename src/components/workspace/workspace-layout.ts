export const WORKSPACE_ACTIVITIES = ["website", "assets", "design", "sections", "history"] as const;
export type WorkspaceActivity = (typeof WORKSPACE_ACTIVITIES)[number];
export type WorkspaceBreakpoint = "desktop" | "compact" | "mobile";
export type MobileSurface = "tools" | "preview" | "agent";
export type WorkspaceLayout = { primary: boolean; agent: boolean; primaryWidth: number; agentWidth: number; activity: WorkspaceActivity; mobileSurface: MobileSurface; zoom: number; fit: boolean };
export const DEFAULT_WORKSPACE_LAYOUT: WorkspaceLayout = { primary: true, agent: true, primaryWidth: 286, agentWidth: 390, activity: "website", mobileSurface: "preview", zoom: 100, fit: true };

export function breakpointFor(width: number): WorkspaceBreakpoint { return width < 768 ? "mobile" : width < 1280 ? "compact" : "desktop"; }
export function isWorkspaceActivity(value: unknown): value is WorkspaceActivity { return typeof value === "string" && (WORKSPACE_ACTIVITIES as readonly string[]).includes(value); }
export function normalizeWorkspaceLayout(value: Partial<WorkspaceLayout>, breakpoint: WorkspaceBreakpoint): WorkspaceLayout {
  const merged = { ...DEFAULT_WORKSPACE_LAYOUT, ...value };
  const layout: WorkspaceLayout = { ...merged, activity: isWorkspaceActivity(merged.activity) ? merged.activity : "website", primaryWidth: Math.min(440, Math.max(224, Number(merged.primaryWidth) || 286)), agentWidth: Math.min(640, Math.max(320, Number(merged.agentWidth) || 390)), zoom: Math.min(150, Math.max(50, Number(merged.zoom) || 100)), mobileSurface: ["tools", "preview", "agent"].includes(merged.mobileSurface) ? merged.mobileSurface : "preview" };
  if (breakpoint === "compact" && layout.agent) layout.primary = false;
  if (breakpoint === "mobile") { layout.primary = layout.mobileSurface === "tools"; layout.agent = layout.mobileSurface === "agent"; }
  return layout;
}
