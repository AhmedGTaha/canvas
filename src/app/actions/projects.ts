"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { ProjectService } from "@/domain/projects/service";
import { userMessage } from "@/domain/shared/errors";
import { requireAuthenticatedUser } from "@/server/auth/session";
import type { MutationState } from "./workspaces";

export async function createProjectAction(_state: MutationState, formData: FormData): Promise<MutationState> {
  let projectId: string;
  try {
    const user = await requireAuthenticatedUser();
    const project = await new ProjectService().create(user.id, {
      workspaceId: formData.get("workspaceId"),
      name: formData.get("name"),
      description: formData.get("description"),
    });
    projectId = project.id;
  } catch (error: unknown) {
    if (error instanceof ZodError) return { fieldErrors: error.flatten().fieldErrors as Record<string, string[]> };
    return { error: userMessage(error, "Project could not be created.") };
  }
  revalidatePath("/dashboard", "layout");
  redirect(`/projects/${projectId}`);
}

export async function renameProjectAction(_state: MutationState, formData: FormData): Promise<MutationState> {
  try {
    const user = await requireAuthenticatedUser();
    const project = await new ProjectService().rename(user.id, { id: formData.get("id"), name: formData.get("name") });
    revalidatePath(`/projects/${project.id}`);
    revalidatePath(`/workspaces/${project.workspaceId}`);
    revalidatePath("/dashboard");
    return { success: "Project renamed." };
  } catch (error: unknown) {
    if (error instanceof ZodError) return { fieldErrors: error.flatten().fieldErrors as Record<string, string[]> };
    return { error: userMessage(error, "Project could not be renamed.") };
  }
}

export async function archiveProjectAction(_state: MutationState, formData: FormData): Promise<MutationState> {
  try {
    const user = await requireAuthenticatedUser();
    await new ProjectService().archive(user.id, formData.get("id"));
  } catch (error: unknown) {
    return { error: userMessage(error, "Website could not be moved to archive.") };
  }
  revalidatePath("/dashboard", "layout");
  revalidatePath(`/workspaces/${formData.get("workspaceId")}`);
  revalidatePath("/archive");
  redirect("/archive");
}

export async function restoreProjectAction(_state: MutationState, formData: FormData): Promise<MutationState> {
  try {
    const user = await requireAuthenticatedUser();
    const project = await new ProjectService().restore(user.id, formData.get("id"));
    revalidatePath(`/workspaces/${project.workspaceId}`);
  } catch (error: unknown) {
    return { error: userMessage(error, "Website could not be restored.") };
  }
  revalidatePath("/dashboard", "layout");
  revalidatePath("/archive");
  return { success: "Website restored." };
}
