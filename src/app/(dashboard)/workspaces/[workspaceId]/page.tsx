import { notFound } from "next/navigation";
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
  return <><PageHeader eyebrow="Workspace" title={workspace.name} description="Projects in this workspace." actions={<><RenameWorkspaceDialog id={workspace.id} name={workspace.name} /><CreateProjectDialog workspaceId={workspace.id} /></>} />{projects.length === 0 ? <EmptyState title="No projects yet" description="Create your first Canvas project." action={<CreateProjectDialog workspaceId={workspace.id} />} /> : <div className="card-grid">{projects.map((project) => <ProjectCard key={project.id} project={project} />)}</div>}</>;
}
