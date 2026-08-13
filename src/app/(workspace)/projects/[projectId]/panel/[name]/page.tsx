import { notFound } from "next/navigation";
import { StandalonePanel, isPanelName, resolvePanel } from "@/components/workspace/project-panel";

export async function generateMetadata({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return { title: name.charAt(0).toUpperCase() + name.slice(1) };
}

/**
 * The same tool loaded directly — a bookmark, a shared link, or a full page
 * reload. There is no workspace behind it to overlay, so it renders as its own
 * screen with a way back.
 */
export default async function PanelPage({ params }: { params: Promise<{ projectId: string; name: string }> }) {
  const { projectId, name } = await params;
  if (!isPanelName(name)) notFound();
  const view = await resolvePanel(projectId, name);
  return <StandalonePanel projectId={projectId} view={view} />;
}
