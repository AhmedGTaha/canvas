/**
 * Where "which project tool is open" lives.
 *
 * It is a query parameter on the project URL, not a route of its own. That is
 * deliberate: a distinct route means Next has somewhere to fall back to when a
 * navigation is not a clean client-side transition — a reload, a bookmark, or a
 * `router.refresh()` from inside a panel — and the user lands on a bare screen
 * with the website they were editing gone. With the tool in the query string
 * there is no second route to fall back to, so the whole class of bug cannot
 * happen rather than being patched case by case.
 */

/** The parameters that describe an open tool. Everything else on the URL — the
 *  page being previewed, say — belongs to the workspace and must survive. */
export const PANEL_PARAMS = ["tool", "node"] as const;

/** Same-document navigations the workspace performs itself, so a close knows
 *  whether going back lands on the workspace or somewhere else entirely. */
let pushedPanels = 0;

/** Records that opening a tool added a history entry. */
export function notePanelPushed() { pushedPanels += 1; }

/** Consumes one recorded entry; true when closing should be a history back. */
export function takePanelPushed() {
  if (pushedPanels <= 0) return false;
  pushedPanels -= 1;
  return true;
}

/** Test seam — the counter is module state shared by the shell and the panel. */
export function resetPanelHistory() { pushedPanels = 0; }

/** The current URL with `name` opened, preserving every unrelated parameter. */
export function panelHref(url: URL, name: string, query: Record<string, string> = {}) {
  const next = new URL(url.href);
  next.searchParams.set("tool", name);
  next.searchParams.delete("node");
  for (const [key, value] of Object.entries(query)) next.searchParams.set(key, value);
  return `${next.pathname}${next.search}`;
}

/** The current URL with no tool open. */
export function closedPanelHref(url: URL) {
  const next = new URL(url.href);
  for (const key of PANEL_PARAMS) next.searchParams.delete(key);
  return `${next.pathname}${next.search}`;
}
