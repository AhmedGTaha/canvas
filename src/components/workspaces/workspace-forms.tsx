"use client";

import { useActionState } from "react";
import { createWorkspaceAction, renameWorkspaceAction, type MutationState } from "@/app/actions/workspaces";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/form-controls";
import { SubmitButton } from "@/components/ui/submit-button";

const initialState: MutationState = {};

export function CreateWorkspaceDialog() {
  const [state, action] = useActionState(createWorkspaceAction, initialState);
  return <Dialog title="Create workspace" description="A workspace keeps related website projects together." triggerLabel="Create workspace">
    <form action={action} className="stack">
      <Input name="name" label="Workspace name" placeholder="Acme websites" required maxLength={100} autoFocus error={state.fieldErrors?.name?.[0]} />
      {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
      <SubmitButton pendingLabel="Creating…">Create workspace</SubmitButton>
    </form>
  </Dialog>;
}

export function RenameWorkspaceDialog({ id, name }: { id: string; name: string }) {
  const [state, action] = useActionState(renameWorkspaceAction, initialState);
  return <Dialog title="Rename workspace" triggerLabel="Rename" triggerVariant="secondary">
    <form action={action} className="stack">
      <input type="hidden" name="id" value={id} />
      <Input name="name" label="Workspace name" defaultValue={name} required maxLength={100} error={state.fieldErrors?.name?.[0]} />
      {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
      {state.success ? <p className="form-success" role="status">{state.success}</p> : null}
      <SubmitButton>Save changes</SubmitButton>
    </form>
  </Dialog>;
}
