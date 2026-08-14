import { FolderKanban } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { CreateWorkspaceDialog } from "@/components/workspaces/workspace-forms";
import { WorkspaceCard } from "@/components/workspaces/workspace-card";
import { WorkspaceService } from "@/domain/workspaces/service";
import { requireAuthenticatedUser } from "@/server/auth/session";

export default async function WorkspacesPage() {
  const user = await requireAuthenticatedUser();
  const workspaces = await new WorkspaceService().list(user.id);
  return <>
    <PageHeader title="Workspaces" description="A workspace groups related websites and the people who work on them." actions={workspaces.length ? <CreateWorkspaceDialog /> : undefined} />
    {workspaces.length === 0
      ? <EmptyState icon={<FolderKanban size={19} />} title="No workspaces yet" description="Create a workspace to hold your first website." action={<CreateWorkspaceDialog />} />
      : <div className="entity-list">{workspaces.map((workspace) => <WorkspaceCard key={workspace.id} workspace={workspace} />)}</div>}
  </>;
}
