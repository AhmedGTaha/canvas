import { redirect } from "next/navigation";

/**
 * Kept so existing links and bookmarks still work. This screen is now the media panel inside the workspace,
 * so the old standalone route forwards there instead of being a separate page.
 */
export default async function LegacyRoute({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  redirect(`/projects/${projectId}/panel/media`);
}
