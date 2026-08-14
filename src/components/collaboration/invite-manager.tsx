"use client";

import { Clock, RefreshCw } from "lucide-react";
import { useActionState } from "react";
import { createInviteAction, revokeInviteAction, type InviteActionState } from "@/app/actions/collaboration";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { InlineAlert } from "@/components/ui/feedback";
import { SubmitButton } from "@/components/ui/submit-button";

const initialState: InviteActionState = {};

export function InviteManager({ projectId, currentInvite }: { projectId: string; currentInvite?: { id: string; expiresAt: string } }) {
  const [state, action] = useActionState(createInviteAction, initialState);
  const active = state.inviteUrl ? { id: state.inviteId, expiresAt: state.expiresAt } : currentInvite;
  return <div className="invite-manager">
    <p className="text-body text-muted">Anyone with an active link can open this website and work on it. Revoke a link to end that access.</p>
    {state.inviteUrl ? <div className="invite-link-row"><code>{state.inviteUrl}</code><CopyButton value={state.inviteUrl} /></div>
      : active ? <InlineAlert tone="info" title="A link is already active">Regenerate it to copy a new one. The previous link stops working.</InlineAlert> : null}
    {active?.expiresAt ? <p className="invite-expiry"><Clock size={13} aria-hidden="true" />Expires {new Date(active.expiresAt).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })}</p> : null}
    {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
    {state.success ? <p className="form-success" role="status">{state.success}</p> : null}
    <div className="inline-actions">
      <form action={action}><input type="hidden" name="projectId" value={projectId} /><SubmitButton pendingLabel="Generating…">{active ? <><RefreshCw size={16} />Regenerate link</> : "Generate invite link"}</SubmitButton></form>
      {active?.id ? <form action={revokeInviteAction}><input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="inviteId" value={active.id} /><Button type="submit" variant="secondary">Revoke</Button></form> : null}
    </div>
  </div>;
}
