import { notFound } from "next/navigation";
import { DetailDrawer, FocusedWorkSurface } from "@/components/workspace/feature-panel";
import { isPanelName, resolvePanel } from "@/components/workspace/project-panel";

/**
 * A project tool opened from the menu bar, intercepted into the workspace's
 * panel slot so it renders over the website you were editing.
 */
export default async function InterceptedPanel({ params, searchParams }: { params: Promise<{ projectId: string; name: string }>; searchParams: Promise<{ node?: string }> }) {
  const { projectId, name } = await params;
  if (!isPanelName(name)) notFound();
  const { node } = await searchParams;
  const view = await resolvePanel(projectId, name, { nodeId: node });
  const Surface = view.size === "drawer" ? DetailDrawer : FocusedWorkSurface;
  return <Surface title={view.title} description={view.description} actions={view.actions}>{view.body}</Surface>;
}
