import { CreateWorkspaceDialog } from "@/components/workspaces/workspace-forms";
import { ProjectCard } from "@/components/projects/project-card";
import { EmptyState } from "@/components/ui/states";
import { PageHeader } from "@/components/ui/page-header";
import { ProjectService } from "@/domain/projects/service";
import { WorkspaceService } from "@/domain/workspaces/service";
import { requireAuthenticatedUser } from "@/server/auth/session";

export default async function DashboardPage() {
  const user = await requireAuthenticatedUser();
  const [workspaces, projects] = await Promise.all([new WorkspaceService().list(user.id), new ProjectService().listAccessible(user.id)]);
  return <>
    <PageHeader eyebrow="Projects" title="Your websites" description="Create, organize, and open your Canvas projects." actions={<CreateWorkspaceDialog />} />
    {workspaces.length === 0 && projects.shared.length === 0 ? <EmptyState title="No projects yet" description="Create a workspace to start building, or join a project through an invitation." action={<CreateWorkspaceDialog />} /> : <div className="project-sections">
      <section><div className="list-heading"><h2>My projects</h2><span>{projects.owned.length}</span></div>{projects.owned.length ? <div className="card-grid">{projects.owned.map((project) => <ProjectCard key={project.id} project={project} />)}</div> : <p className="inline-empty">Open a workspace to create your first Canvas project.</p>}</section>
      {projects.shared.length ? <section><div className="list-heading"><h2>Shared with me</h2><span>{projects.shared.length}</span></div><div className="card-grid">{projects.shared.map((project) => <ProjectCard key={project.id} project={project} />)}</div></section> : null}
    </div>}
  </>;
}
