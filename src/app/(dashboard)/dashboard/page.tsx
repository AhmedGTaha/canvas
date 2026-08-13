import Link from "next/link";
import { CreateWorkspaceDialog } from "@/components/workspaces/workspace-forms";
import { CreateProjectDialog } from "@/components/projects/project-forms";
import { ProjectCard } from "@/components/projects/project-card";
import { EmptyState } from "@/components/ui/states";
import { PageHeader } from "@/components/ui/page-header";
import { ProjectService } from "@/domain/projects/service";
import { WorkspaceService } from "@/domain/workspaces/service";
import { requireAuthenticatedUser } from "@/server/auth/session";

export default async function DashboardPage() {
  const user = await requireAuthenticatedUser();
  const [workspaces, projects] = await Promise.all([new WorkspaceService().list(user.id), new ProjectService().listAccessible(user.id)]);
  const nothingYet = workspaces.length === 0 && projects.shared.length === 0;

  // Creating a website used to mean going to Workspaces, opening one, and only
  // then finding the button. With at least one workspace it belongs right here.
  const primary = workspaces.length
    ? <CreateProjectDialog workspaces={workspaces.map((workspace) => ({ id: workspace.id, name: workspace.name }))} />
    : <CreateWorkspaceDialog />;

  return <>
    <PageHeader
      eyebrow="Websites"
      title="Your websites"
      description="Open a website to edit it, or start a new one."
      actions={primary}
    />
    {nothingYet
      ? <EmptyState
          title="No websites yet"
          description="Create a workspace to hold your first website, or join someone else's project through an invitation link."
          action={<CreateWorkspaceDialog />}
        />
      : <div className="project-sections">
          <section>
            <div className="list-heading"><h2>Yours</h2><span>{projects.owned.length}</span></div>
            {projects.owned.length
              ? <div className="card-grid">{projects.owned.map((project) => <ProjectCard key={project.id} project={project} />)}</div>
              : <p className="inline-empty">No websites yet. Use <strong>New website</strong> above to create your first one.</p>}
          </section>
          {projects.shared.length ? <section>
            <div className="list-heading"><h2>Shared with you</h2><span>{projects.shared.length}</span></div>
            <div className="card-grid">{projects.shared.map((project) => <ProjectCard key={project.id} project={project} />)}</div>
          </section> : null}
          {workspaces.length ? <section>
            <div className="list-heading"><h2>Workspaces</h2><span>{workspaces.length}</span></div>
            <p className="inline-empty">
              Workspaces group related websites. <Link href="/workspaces">Manage your workspaces</Link>.
            </p>
          </section> : null}
        </div>}
  </>;
}
