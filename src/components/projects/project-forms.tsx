"use client";

import { useActionState } from "react";
import { createProjectAction, renameProjectAction } from "@/app/actions/projects";
import type { MutationState } from "@/app/actions/workspaces";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select, Textarea } from "@/components/ui/form-controls";
import { SubmitButton } from "@/components/ui/submit-button";

const initialState: MutationState = {};

/**
 * Creates a website.
 *
 * Pass `workspaceId` when the workspace is already the context (inside a
 * workspace). Pass `workspaces` to let the person choose — that is what makes
 * "New website" work straight from the projects list, instead of making them
 * walk through Workspaces first.
 */
export function CreateProjectDialog({ workspaceId, workspaces, triggerLabel = "New website" }: { workspaceId?: string; workspaces?: Array<{ id: string; name: string }>; triggerLabel?: string }) {
  const [state, action] = useActionState(createProjectAction, initialState);
  const choices = workspaces ?? [];
  const needsChoice = !workspaceId && choices.length > 0;
  return <Dialog title="New website" description="Just a name to begin. Brand, pages and content all come next." triggerLabel={triggerLabel}>
    <form action={action} className="stack">
      {workspaceId ? <input type="hidden" name="workspaceId" value={workspaceId} /> : null}
      <Input name="name" label="Website name" placeholder="Acme company website" required maxLength={100} autoFocus error={state.fieldErrors?.name?.[0]} />
      <Textarea name="description" label="Description (optional)" placeholder="What this website is for" maxLength={500} rows={3} error={state.fieldErrors?.description?.[0]} />
      {needsChoice ? <Select name="workspaceId" label="Workspace" defaultValue={choices[0]?.id} hint="Workspaces group related websites together." error={state.fieldErrors?.workspaceId?.[0]}>
        {choices.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
      </Select> : null}
      {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
      <SubmitButton pendingLabel="Creating…">Create website</SubmitButton>
    </form>
  </Dialog>;
}

export function RenameProjectDialog({ id, name }: { id: string; name: string }) {
  const [state, action] = useActionState(renameProjectAction, initialState);
  return <Dialog title="Rename website" triggerLabel="Rename" triggerVariant="secondary">
    <form action={action} className="stack">
      <input type="hidden" name="id" value={id} />
      <Input name="name" label="Website name" defaultValue={name} required maxLength={100} error={state.fieldErrors?.name?.[0]} />
      {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
      {state.success ? <p className="form-success" role="status">{state.success}</p> : null}
      <SubmitButton>Save changes</SubmitButton>
    </form>
  </Dialog>;
}
