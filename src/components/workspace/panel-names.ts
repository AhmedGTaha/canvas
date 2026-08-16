/** Every project tool reachable from the workspace, as `?tool=` accepts them. */
export const PANEL_NAMES = ["overview", "pages", "media", "blocks", "brand", "export", "collaborators", "settings", "ai", "shortcuts"] as const;
export type PanelName = (typeof PANEL_NAMES)[number];

export function isPanelName(value: string): value is PanelName {
  return (PANEL_NAMES as readonly string[]).includes(value);
}
