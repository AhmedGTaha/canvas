import { notFound } from "next/navigation";
import { PageTreeManager } from "@/components/pages/page-tree-manager";
import { ProjectNav } from "@/components/projects/project-nav";
import { PageHeader } from "@/components/ui/page-header";
import { PageTreeService } from "@/domain/pages/service";
import { ProjectService } from "@/domain/projects/service";
import { requireAuthenticatedUser } from "@/server/auth/session";

export default async function PagesPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const user = await requireAuthenticatedUser();
  let project;
  let nodes;
  try {
    [project, nodes] = await Promise.all([new ProjectService().read(user.id, projectId), new PageTreeService().listTree(user.id, projectId)]);
  } catch { notFound(); }
  return <><PageHeader eyebrow={project.name} title="Pages" description="Organize the pages and folders that make up this website." /><ProjectNav projectId={project.id} /><PageTreeManager projectId={project.id} nodes={nodes} /></>;
}
