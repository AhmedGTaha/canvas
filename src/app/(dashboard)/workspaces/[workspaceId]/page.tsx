import { notFound } from "next/navigation";
import { Globe } from "lucide-react";
import { CreateProjectDialog } from "@/components/projects/project-forms";
import { ProjectCard } from "@/components/projects/project-card";
import { EmptyState } from "@/components/ui/states";
import { PageHeader } from "@/components/ui/page-header";
import { RenameWorkspaceDialog } from "@/components/workspaces/workspace-forms";
import { ProjectService } from "@/domain/projects/service";
import { WorkspaceService } from "@/domain/workspaces/service";
import { requireAuthenticatedUser } from "@/server/auth/session";

export default async function WorkspacePage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const user = await requireAuthenticatedUser();
  let workspace;
  let projects;
  try {
    workspace = await new WorkspaceService().read(user.id, workspaceId);
    projects = await new ProjectService().listInWorkspace(user.id, workspace.id);
  } catch { notFound(); }
  return <>
    <PageHeader
      title={workspace.name}
      description={projects.length === 1 ? "1 website in this workspace." : `${projects.length} websites in this workspace.`}
      back={{ href: "/workspaces", label: "Workspaces" }}
      actions={<><RenameWorkspaceDialog id={workspace.id} name={workspace.name} /><CreateProjectDialog workspaceId={workspace.id} /></>}
    />
    {projects.length === 0
      ? <EmptyState icon={<Globe size={19} />} title="No websites here yet" description="Create the first website in this workspace and start describing the pages you want." action={<CreateProjectDialog workspaceId={workspace.id} />} />
      : <div className="entity-list">{projects.map((project) => <ProjectCard key={project.id} project={project} />)}</div>}
  </>;
}
