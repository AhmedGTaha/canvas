"use client";

import { useActionState } from "react";
import { acceptInviteAction, type InviteActionState } from "@/app/actions/collaboration";
import { SubmitButton } from "@/components/ui/submit-button";

export function AcceptInviteForm({ token, alreadyHasAccess }: { token: string; alreadyHasAccess: boolean }) {
  const [state, action] = useActionState(acceptInviteAction, {} as InviteActionState);
  return <form action={action} className="stack"><input type="hidden" name="token" value={token} />{state.error ? <p className="form-error" role="alert">{state.error}</p> : null}<SubmitButton pendingLabel="Joining…">{alreadyHasAccess ? "Open project" : "Join project"}</SubmitButton></form>;
}
