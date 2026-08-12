import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { CreateWorkspaceDialog } from "@/components/workspaces/workspace-forms";
import { WorkspaceCard } from "@/components/workspaces/workspace-card";
import { WorkspaceService } from "@/domain/workspaces/service";
import { requireAuthenticatedUser } from "@/server/auth/session";

export default async function WorkspacesPage() {
  const user = await requireAuthenticatedUser();
  const workspaces = await new WorkspaceService().list(user.id);
  return <><PageHeader eyebrow="Workspaces" title="Your workspaces" description="Keep related website projects together." actions={<CreateWorkspaceDialog />} />{workspaces.length === 0 ? <EmptyState title="No workspaces yet" description="Create a workspace to start building your first website." action={<CreateWorkspaceDialog />} /> : <div className="card-grid">{workspaces.map((workspace) => <WorkspaceCard key={workspace.id} workspace={workspace} />)}</div>}</>;
}
