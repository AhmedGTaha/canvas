"use client";

import { useActionState } from "react";
import { createProjectAction, renameProjectAction } from "@/app/actions/projects";
import type { MutationState } from "@/app/actions/workspaces";
import { Dialog } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/form-controls";
import { SubmitButton } from "@/components/ui/submit-button";

const initialState: MutationState = {};

export function CreateProjectDialog({ workspaceId }: { workspaceId: string }) {
  const [state, action] = useActionState(createProjectAction, initialState);
  return <Dialog title="Create project" description="Start with the basics. Brand and AI setup come later." triggerLabel="Create project">
    <form action={action} className="stack">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <Input name="name" label="Project name" placeholder="Company website" required maxLength={100} autoFocus error={state.fieldErrors?.name?.[0]} />
      <Textarea name="description" label="Description (optional)" placeholder="A short description of this website" maxLength={500} rows={4} error={state.fieldErrors?.description?.[0]} />
      {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
      <SubmitButton pendingLabel="Creating…">Create project</SubmitButton>
    </form>
  </Dialog>;
}

export function RenameProjectDialog({ id, name }: { id: string; name: string }) {
  const [state, action] = useActionState(renameProjectAction, initialState);
  return <Dialog title="Rename project" triggerLabel="Rename">
    <form action={action} className="stack">
      <input type="hidden" name="id" value={id} />
      <Input name="name" label="Project name" defaultValue={name} required maxLength={100} error={state.fieldErrors?.name?.[0]} />
      {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
      {state.success ? <p className="form-success" role="status">{state.success}</p> : null}
      <SubmitButton>Save changes</SubmitButton>
    </form>
  </Dialog>;
}
