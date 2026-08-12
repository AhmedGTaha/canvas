import { CreateWorkspaceDialog } from "@/components/workspaces/workspace-forms";
import { ProjectCard } from "@/components/projects/project-card";
import { EmptyState } from "@/components/ui/states";
import { PageHeader } from "@/components/ui/page-header";
import { ProjectService } from "@/domain/projects/service";
import { WorkspaceService } from "@/domain/workspaces/service";
import { requireAuthenticatedUser } from "@/server/auth/session";

export default async function DashboardPage() {
  const user = await requireAuthenticatedUser();
  const [workspaces, projects] = await Promise.all([new WorkspaceService().list(user.id), new ProjectService().listOwned(user.id)]);
  return <>
    <PageHeader eyebrow="Projects" title="Your websites" description="Create, organize, and open your Canvas projects." actions={<CreateWorkspaceDialog />} />
    {workspaces.length === 0 ? <EmptyState title="No workspaces yet" description="Create a workspace to start building your first website." action={<CreateWorkspaceDialog />} /> : projects.length === 0 ? <EmptyState title="No projects yet" description="Open a workspace to create your first Canvas project." /> : <div className="card-grid">{projects.map((project) => <ProjectCard key={project.id} project={project} />)}</div>}
  </>;
}
