"use client";

import { useActionState } from "react";
import { archiveWorkspaceAction, createWorkspaceAction, renameWorkspaceAction, restoreWorkspaceAction, type MutationState } from "@/app/actions/workspaces";
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

export function ArchiveWorkspaceDialog({ id, name }: { id: string; name: string }) {
  const [state, action] = useActionState(archiveWorkspaceAction, initialState);
  return <Dialog title={`Archive ${name}?`} description="It will disappear from your workspaces. Its websites stay intact and return when you restore the workspace." triggerLabel="Archive workspace" triggerVariant="danger">
    <form action={action} className="stack">
      <input type="hidden" name="id" value={id} />
      {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
      <SubmitButton variant="danger" pendingLabel="Archiving…">Archive workspace</SubmitButton>
    </form>
  </Dialog>;
}

export function RestoreWorkspaceButton({ id }: { id: string }) {
  const [state, action] = useActionState(restoreWorkspaceAction, initialState);
  return <form action={action} className="archive-row-action">
    <input type="hidden" name="id" value={id} />
    <SubmitButton variant="secondary" pendingLabel="Restoring…">Restore</SubmitButton>
    {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
    {state.success ? <p className="form-success" role="status">{state.success}</p> : null}
  </form>;
}
