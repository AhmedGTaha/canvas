import { redirect } from "next/navigation";
import { isPanelName } from "@/components/workspace/panel-names";

/**
 * Project tools used to be routes of their own. They are now a parameter on the
 * project URL, so this path exists only to carry old bookmarks and shared links
 * across — it renders nothing itself.
 */
export default async function LegacyPanelRoute({ params, searchParams }: { params: Promise<{ projectId: string; name: string }>; searchParams: Promise<{ node?: string }> }) {
  const { projectId, name } = await params;
  if (!isPanelName(name)) redirect(`/projects/${projectId}`);
  const { node } = await searchParams;
  const query = new URLSearchParams({ tool: name, ...(node ? { node } : {}) });
  redirect(`/projects/${projectId}?${query}`);
}
