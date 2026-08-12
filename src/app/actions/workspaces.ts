"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { userMessage } from "@/domain/shared/errors";
import { WorkspaceService } from "@/domain/workspaces/service";
import { requireAuthenticatedUser } from "@/server/auth/session";

export type MutationState = { error?: string; fieldErrors?: Record<string, string[]>; success?: string };

export async function createWorkspaceAction(_state: MutationState, formData: FormData): Promise<MutationState> {
  let workspaceId: string;
  try {
    const user = await requireAuthenticatedUser();
    const workspace = await new WorkspaceService().create(user.id, { name: formData.get("name") });
    workspaceId = workspace.id;
  } catch (error: unknown) {
    if (error instanceof ZodError) return { fieldErrors: error.flatten().fieldErrors as Record<string, string[]> };
    return { error: userMessage(error, "Workspace could not be created.") };
  }
  revalidatePath("/dashboard", "layout");
  redirect(`/workspaces/${workspaceId}`);
}

export async function renameWorkspaceAction(_state: MutationState, formData: FormData): Promise<MutationState> {
  try {
    const user = await requireAuthenticatedUser();
    const workspace = await new WorkspaceService().rename(user.id, { id: formData.get("id"), name: formData.get("name") });
    revalidatePath(`/workspaces/${workspace.id}`);
    revalidatePath("/workspaces");
    return { success: "Workspace renamed." };
  } catch (error: unknown) {
    if (error instanceof ZodError) return { fieldErrors: error.flatten().fieldErrors as Record<string, string[]> };
    return { error: userMessage(error, "Workspace could not be renamed.") };
  }
}
