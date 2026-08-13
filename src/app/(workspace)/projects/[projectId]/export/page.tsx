import { notFound } from "next/navigation";
import { ExportManager } from "@/components/export/export-manager";
import { ProjectNav } from "@/components/projects/project-nav";
import { PageHeader } from "@/components/ui/page-header";
import { ProjectService } from "@/domain/projects/service";
import { requireAuthenticatedUser } from "@/server/auth/session";

export default async function ExportPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const user = await requireAuthenticatedUser();
  let project;
  try { project = await new ProjectService().read(user.id, projectId); } catch { notFound(); }
  return <>
    <PageHeader eyebrow={project.name} title="Export" description="Download this website as a standalone Next.js project you can run and host yourself." />
    <ProjectNav projectId={project.id} />
    <ExportManager projectId={project.id} />
  </>;
}
