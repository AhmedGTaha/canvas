import Link from "next/link";
import { Globe } from "lucide-react";
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
  const nothingYet = workspaces.length === 0 && projects.shared.length === 0 && projects.owned.length === 0;
  const workspaceNames = new Map(workspaces.map((workspace) => [workspace.id, workspace.name]));

  // Creating a website is the reason most people open this screen, so the
  // control is here rather than three clicks away inside a workspace. Without a
  // workspace to put it in, the first step is that instead.
  const primary = workspaces.length
    ? <CreateProjectDialog workspaces={workspaces.map((workspace) => ({ id: workspace.id, name: workspace.name }))} />
    : <CreateWorkspaceDialog />;

  return <>
    <PageHeader title="Your websites" description="Open a website to keep building it, or start a new one." actions={nothingYet ? undefined : primary} />

    {nothingYet
      ? <EmptyState
          icon={<Globe size={19} />}
          title="Build your first website"
          description="Websites live in a workspace. Create one to get started — you can describe the pages you want as soon as it exists."
          action={<CreateWorkspaceDialog />}
        />
      : <div className="screen-sections">
          <section aria-labelledby="owned-heading">
            <div className="section-head"><h2 id="owned-heading">Yours<span className="count">{projects.owned.length}</span></h2></div>
            {projects.owned.length
              ? <div className="entity-list">{projects.owned.map((project) => <ProjectCard key={project.id} project={project} workspaceName={workspaceNames.get(project.workspaceId)} />)}</div>
              : <p className="quiet-note">Nothing here yet. Use <strong>New website</strong> to create your first one.</p>}
          </section>

          {projects.shared.length ? <section aria-labelledby="shared-heading">
            <div className="section-head"><h2 id="shared-heading">Shared with you<span className="count">{projects.shared.length}</span></h2></div>
            <div className="entity-list">{projects.shared.map((project) => <ProjectCard key={project.id} project={project} />)}</div>
          </section> : null}

          {workspaces.length ? <p className="quiet-note">
            Workspaces group related websites. <Link href="/workspaces">Manage workspaces</Link>.
          </p> : null}
        </div>}
  </>;
}
