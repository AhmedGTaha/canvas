import { notFound } from "next/navigation";
import { MediaManager } from "@/components/media/media-manager";
import { ProjectNav } from "@/components/projects/project-nav";
import { PageHeader } from "@/components/ui/page-header";
import { MediaService } from "@/domain/media/service";
import { ProjectService } from "@/domain/projects/service";
import { requireAuthenticatedUser } from "@/server/auth/session";

export default async function MediaPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const user = await requireAuthenticatedUser();
  let project;
  let library;
  try {
    [project, library] = await Promise.all([new ProjectService().read(user.id, projectId), new MediaService().list(user.id, { projectId })]);
  } catch { notFound(); }
  return <><PageHeader eyebrow={project.name} title="Media" description="Upload and organize the project’s private image library." /><ProjectNav projectId={project.id} /><MediaManager projectId={project.id} initialFolders={library.folders} initialAssets={library.assets} /></>;
}
