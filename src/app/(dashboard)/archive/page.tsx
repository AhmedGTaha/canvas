import { ArchiveRestore, Box } from "lucide-react";
import { RestoreProjectButton } from "@/components/projects/project-forms";
import { RestoreWorkspaceButton } from "@/components/workspaces/workspace-forms";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { ProjectService } from "@/domain/projects/service";
import { WorkspaceService } from "@/domain/workspaces/service";
import { requireAuthenticatedUser } from "@/server/auth/session";

export default async function ArchivePage() {
  const user = await requireAuthenticatedUser();
  const [workspaces, projects] = await Promise.all([
    new WorkspaceService().listArchived(user.id),
    new ProjectService().listArchived(user.id),
  ]);
  const isEmpty = workspaces.length === 0 && projects.length === 0;

  return <>
    <PageHeader title="Archive" description="Removed workspaces and websites stay here until you need them again." />
    {isEmpty ? <EmptyState icon={<ArchiveRestore size={19} />} title="Nothing archived" description="When you archive a workspace or website, you can restore it here." /> : <div className="screen-sections">
      {workspaces.length ? <section aria-labelledby="archived-workspaces-heading">
        <div className="section-head"><h2 id="archived-workspaces-heading">Workspaces<span className="count">{workspaces.length}</span></h2></div>
        <div className="archive-list">{workspaces.map((workspace) => <div className="archive-row" key={workspace.id}>
          <span className="entity-row-icon" aria-hidden="true"><Box size={16} /></span>
          <span className="entity-row-main"><strong>{workspace.name}</strong><small>Archived {formatDate(workspace.archivedAt)}</small></span>
          <RestoreWorkspaceButton id={workspace.id} />
        </div>)}</div>
      </section> : null}
      {projects.length ? <section aria-labelledby="archived-websites-heading">
        <div className="section-head"><h2 id="archived-websites-heading">Websites<span className="count">{projects.length}</span></h2></div>
        <div className="archive-list">{projects.map((project) => <div className="archive-row" key={project.id}>
          <span className="entity-row-icon" aria-hidden="true"><ArchiveRestore size={16} /></span>
          <span className="entity-row-main"><strong>{project.name}</strong><small>{project.description || `Archived ${formatDate(project.updatedAt)}`}</small></span>
          <RestoreProjectButton id={project.id} />
        </div>)}</div>
      </section> : null}
    </div>}
  </>;
}

function formatDate(date: Date | null) {
  return date ? date.toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" }) : "recently";
}
