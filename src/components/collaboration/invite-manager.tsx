"use client";

import { Clock, Link as LinkIcon, RefreshCw } from "lucide-react";
import { useActionState } from "react";
import { createInviteAction, revokeInviteAction, type InviteActionState } from "@/app/actions/collaboration";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { SubmitButton } from "@/components/ui/submit-button";

const initialState: InviteActionState = {};

export function InviteManager({ projectId, currentInvite }: { projectId: string; currentInvite?: { id: string; expiresAt: string } }) {
  const [state, action] = useActionState(createInviteAction, initialState);
  const active = state.inviteUrl ? { id: state.inviteId, expiresAt: state.expiresAt } : currentInvite;
  return <div className="invite-manager">
    <div className="invite-copy"><span className="entity-icon"><LinkIcon size={18} /></span><div><h2>Invite collaborators</h2><p>Anyone with this active link can join this project as a collaborator.</p></div></div>
    {state.inviteUrl ? <div className="invite-link-row"><code>{state.inviteUrl}</code><CopyButton value={state.inviteUrl} /></div> : active ? <div className="notice"><Clock size={16} /><span>An active link exists. Regenerate it to copy a new link.</span></div> : null}
    {active?.expiresAt ? <p className="invite-expiry"><Clock size={14} />Expires {new Date(active.expiresAt).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })}</p> : null}
    {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
    {state.success ? <p className="form-success" role="status">{state.success}</p> : null}
    <div className="inline-actions">
      <form action={action}><input type="hidden" name="projectId" value={projectId} /><SubmitButton pendingLabel="Generating…">{active ? <><RefreshCw size={16} />Regenerate link</> : "Generate invite link"}</SubmitButton></form>
      {active?.id ? <form action={revokeInviteAction}><input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="inviteId" value={active.id} /><Button type="submit" variant="secondary">Revoke</Button></form> : null}
    </div>
  </div>;
}
