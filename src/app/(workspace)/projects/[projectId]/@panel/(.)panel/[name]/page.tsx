import { notFound } from "next/navigation";
import { FeaturePanel } from "@/components/workspace/feature-panel";
import { isPanelName, resolvePanel } from "@/components/workspace/project-panel";

/**
 * A project tool opened from the menu bar, intercepted into the workspace's
 * panel slot so it renders over the website you were editing.
 */
export default async function InterceptedPanel({ params }: { params: Promise<{ projectId: string; name: string }> }) {
  const { projectId, name } = await params;
  if (!isPanelName(name)) notFound();
  const view = await resolvePanel(projectId, name);
  return <FeaturePanel title={view.title} description={view.description} size={view.size} actions={view.actions}>{view.body}</FeaturePanel>;
}
