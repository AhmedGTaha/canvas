import { ShieldCheck, UserRound } from "lucide-react";
import { removeCollaboratorAction } from "@/app/actions/collaboration";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";

type Person = { userId: string; displayName: string; email: string; role: "owner" | "collaborator" };

export function MemberList({ projectId, owner, collaborators, canManage }: { projectId: string; owner: Person; collaborators: Person[]; canManage: boolean }) {
  return <div className="member-list">
    {collaborators.length === 0 ? <p className="member-empty">No collaborators yet. Share an invitation link to work on this project together.</p> : null}
    {[owner, ...collaborators].map((person) => <div className="member-row" key={person.userId}>
      <span className="member-avatar">{person.role === "owner" ? <ShieldCheck size={18} /> : <UserRound size={18} />}</span>
      <div className="member-identity"><strong>{person.displayName}</strong><span>{person.email}</span></div>
      <span className="member-role">{person.role}</span>
      {canManage && person.role === "collaborator" ? <ConfirmationDialog title="Remove collaborator" triggerLabel="Remove" description={`Remove ${person.displayName} from this project? Their project access will end immediately.`} action={<form action={removeCollaboratorAction}><input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="userId" value={person.userId} /><Button type="submit" variant="danger">Remove collaborator</Button></form>} /> : <span className="member-action-space" />}
    </div>)}
  </div>;
}
