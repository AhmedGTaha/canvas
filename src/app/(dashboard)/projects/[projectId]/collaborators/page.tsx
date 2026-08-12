import { UsersRound } from "lucide-react";
import { notFound } from "next/navigation";
import { InviteManager } from "@/components/collaboration/invite-manager";
import { MemberList } from "@/components/collaboration/member-list";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { InvitationService } from "@/domain/collaboration/invitation-service";
import { MembershipService } from "@/domain/collaboration/membership-service";
import { ProjectService } from "@/domain/projects/service";
import { requireAuthenticatedUser } from "@/server/auth/session";
import { ProjectNav } from "@/components/projects/project-nav";

export default async function CollaboratorsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const user = await requireAuthenticatedUser();
  let project;
  let access;
  let people;
  try {
    [access, people] = await Promise.all([new ProjectService().readWithRole(user.id, projectId), new MembershipService().list(user.id, projectId)]);
    project = access.project;
  } catch { notFound(); }
  const currentInvite = access.role === "owner" ? await new InvitationService().current(user.id, project.id) : undefined;
  return <><PageHeader eyebrow={project.name} title="Collaborators" description="See who can access this project and manage invitations." /><ProjectNav projectId={project.id} />
    <div className="collaboration-layout">
      {access.role === "owner" ? <Card><InviteManager projectId={project.id} currentInvite={currentInvite ? { id: currentInvite.id, expiresAt: currentInvite.expiresAt.toISOString() } : undefined} /></Card> : <Card className="notice-card"><UsersRound size={20} /><div><h2>Shared project</h2><p>You can collaborate on this project. Only its owner can invite or remove people.</p></div></Card>}
      <Card><div className="section-heading"><div><p className="eyebrow">Access</p><h2>People with access</h2></div></div><MemberList projectId={project.id} owner={people.owner} collaborators={people.collaborators} canManage={access.role === "owner"} /></Card>
    </div>
  </>;
}
