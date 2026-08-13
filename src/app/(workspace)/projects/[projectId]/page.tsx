import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MonitorOff } from "lucide-react";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { MediaService } from "@/domain/media/service";
import { PageTreeService } from "@/domain/pages/service";
import { ProjectService } from "@/domain/projects/service";
import { PreviewManifestService } from "@/generated-runtime/manifest/service";
import { previewUnavailableMessage } from "@/generated-runtime/preview/errors";
import { requireAuthenticatedUser } from "@/server/auth/session";

export async function generateMetadata({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  try {
    const user = await requireAuthenticatedUser();
    const project = await new ProjectService().read(user.id, projectId);
    return { title: project.name };
  } catch { return { title: "Project" }; }
}

/**
 * Opening a project lands here: the unified workspace, not an overview screen.
 */
export default async function ProjectWorkspacePage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ page?: string }> }) {
  const { projectId } = await params;
  const { page } = await searchParams;
  const user = await requireAuthenticatedUser();

  let access;
  let nodes;
  try {
    [access, nodes] = await Promise.all([
      new ProjectService().readWithRole(user.id, projectId),
      new PageTreeService().listTree(user.id, projectId),
    ]);
  } catch { notFound(); }

  let session;
  let media;
  let previewError: string | undefined;
  try {
    [session, media] = await Promise.all([
      new PreviewManifestService().createSession(user.id, projectId),
      new MediaService().list(user.id, { projectId }),
    ]);
  } catch (error) {
    session = null;
    media = null;
    previewError = previewUnavailableMessage(error);
  }

  // Without a preview session there is no website to show, so the workspace
  // cannot be assembled. This is the one case that falls back to a plain screen.
  if (!session || !media) {
    return <div className="standalone-state">
      <div className="empty-state error-state">
        <span className="state-icon"><MonitorOff size={22} /></span>
        <h2>This website could not be opened.</h2>
        <p>{previewError ?? "Check the preview configuration, then try again."}</p>
        <div className="inline-actions">
          <Link href={`/projects/${projectId}`} className="button button-primary">Try again</Link>
          <Link href="/dashboard" className="button button-secondary">All projects</Link>
        </div>
      </div>
    </div>;
  }

  return <WorkspaceShell
    projectId={access.project.id}
    workspaceName={access.workspace.name}
    projectName={access.project.name}
    projectStatus={access.project.status}
    userId={user.id}
    userName={user.displayName}
    canManageProject={access.role === "owner"}
    initialSession={session}
    initialPageId={page}
    initialInstanceId={randomUUID()}
    nodes={nodes}
    mediaAssets={media.assets}
    mediaFolders={media.folders}
  />;
}
