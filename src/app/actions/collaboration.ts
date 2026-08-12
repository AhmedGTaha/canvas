"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { InvitationService } from "@/domain/collaboration/invitation-service";
import { MembershipService } from "@/domain/collaboration/membership-service";
import { userMessage } from "@/domain/shared/errors";
import { requireAuthenticatedUser } from "@/server/auth/session";

export type InviteActionState = { error?: string; inviteUrl?: string; inviteId?: string; expiresAt?: string; success?: string };

export async function createInviteAction(_state: InviteActionState, formData: FormData): Promise<InviteActionState> {
  try {
    const user = await requireAuthenticatedUser();
    const result = await new InvitationService().create(user.id, { projectId: formData.get("projectId") });
    const origin = process.env.APP_URL ?? "http://localhost:3000";
    revalidatePath(`/projects/${result.invite.projectId}/collaborators`);
    return { inviteUrl: `${origin.replace(/\/$/, "")}/invite/${result.token}`, inviteId: result.invite.id, expiresAt: result.invite.expiresAt.toISOString(), success: "Invitation link created." };
  } catch (error: unknown) {
    if (error instanceof ZodError) return { error: error.issues[0]?.message ?? "Invitation could not be created." };
    return { error: userMessage(error, "Invitation could not be created.") };
  }
}

export async function revokeInviteAction(formData: FormData) {
  const user = await requireAuthenticatedUser();
  const projectId = String(formData.get("projectId") ?? "");
  await new InvitationService().revoke(user.id, { projectId, inviteId: formData.get("inviteId") });
  revalidatePath(`/projects/${projectId}/collaborators`);
}

export async function acceptInviteAction(_state: InviteActionState, formData: FormData): Promise<InviteActionState> {
  let projectId: string;
  try {
    const user = await requireAuthenticatedUser();
    const project = await new InvitationService().accept(user.id, { token: formData.get("token") });
    projectId = project.id;
  } catch (error: unknown) {
    return { error: userMessage(error, "Invitation could not be accepted.") };
  }
  revalidatePath("/dashboard");
  redirect(`/projects/${projectId}`);
}

export async function removeCollaboratorAction(formData: FormData) {
  const user = await requireAuthenticatedUser();
  const projectId = String(formData.get("projectId") ?? "");
  await new MembershipService().remove(user.id, { projectId, userId: formData.get("userId") });
  revalidatePath(`/projects/${projectId}/collaborators`);
  revalidatePath("/dashboard");
}
