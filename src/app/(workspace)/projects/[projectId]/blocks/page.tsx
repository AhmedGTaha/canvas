import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { BlockLibrary } from "@/components/blocks/block-library";
import { ProjectNav } from "@/components/projects/project-nav";
import { PageHeader } from "@/components/ui/page-header";
import { BuildingBlockService } from "@/domain/blocks/service";
import { MediaService } from "@/domain/media/service";
import { ProjectService } from "@/domain/projects/service";
import { PreviewManifestService } from "@/generated-runtime/manifest/service";
import { requireAuthenticatedUser } from "@/server/auth/session";
import { previewUnavailableMessage } from "@/generated-runtime/preview/errors";

export default async function BlocksPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const user = await requireAuthenticatedUser();
  let project;
  let blocks;
  let media;
  try {
    [project, blocks, media] = await Promise.all([
      new ProjectService().read(user.id, projectId),
      new BuildingBlockService().list(user.id, { projectId }),
      new MediaService().list(user.id, { projectId }),
    ]);
  } catch { notFound(); }
  let session = null;
  let previewError: string | undefined;
  try { session = await new PreviewManifestService().createSession(user.id, projectId); }
  catch (error) { session = null; previewError = previewUnavailableMessage(error); }
  return <>
    <PageHeader eyebrow={project.name} title="Building Blocks" description="Create reusable navbars, footers, cards, and sections, then use them across your pages." />
    <ProjectNav projectId={project.id} />
    <BlockLibrary projectId={project.id} initialBlocks={blocks} initialSession={session} initialPreviewError={previewError} initialInstanceId={randomUUID()} mediaAssets={media.assets} mediaFolders={media.folders} />
  </>;
}
