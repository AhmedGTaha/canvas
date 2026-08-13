import Link from "next/link";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { BuilderWorkspace } from "@/components/builder/builder-workspace";
import { ProjectNav } from "@/components/projects/project-nav";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { PreviewManifestService } from "@/generated-runtime/manifest/service";
import { ProjectService } from "@/domain/projects/service";
import { requireAuthenticatedUser } from "@/server/auth/session";
import { previewUnavailableMessage } from "@/generated-runtime/preview/errors";
import { MediaService } from "@/domain/media/service";

export default async function BuilderPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ page?: string }> }) {
  const { projectId } = await params; const { page } = await searchParams; const user = await requireAuthenticatedUser();
  let project;
  try { project = await new ProjectService().read(user.id, projectId); } catch { notFound(); }
  let session; let media;
  let previewError: string | undefined;
  try { [session, media] = await Promise.all([new PreviewManifestService().createSession(user.id, projectId), new MediaService().list(user.id, { projectId })]); }
  catch (error) { session = null; media = null; previewError = previewUnavailableMessage(error); }
  return <><PageHeader eyebrow={project.name} title="Builder" description="Create and refine each page with Canvas, then preview it across devices." /><ProjectNav projectId={project.id} />{!session || !media ? <Card className="empty-state error-state"><h2>Preview could not be prepared.</h2><p>{previewError ?? "Check the preview configuration, then try again."}</p><Link href={`/projects/${project.id}/builder`} className={buttonClass()}>Try again</Link></Card> : session.manifest.pages.length ? <BuilderWorkspace projectId={project.id} initialSession={session} initialPageId={page} initialInstanceId={randomUUID()} mediaAssets={media.assets} mediaFolders={media.folders} /> : <Card className="empty-state"><h2>No pages yet</h2><p>Create your first page to start previewing your website.</p><Link href={`/projects/${project.id}/pages`} className={buttonClass()}>Create page</Link></Card>}</>;
}
