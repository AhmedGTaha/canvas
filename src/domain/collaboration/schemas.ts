import { z } from "zod";
import { projectIdSchema } from "@/domain/projects/schemas";

export const projectRoleSchema = z.enum(["owner", "collaborator"]);
export const inviteTokenSchema = z.string().length(43, "Invitation link is invalid.").regex(/^[A-Za-z0-9_-]+$/, "Invitation link is invalid.");
export const inviteIdSchema = z.string().uuid("Invitation not found.");
export const memberUserIdSchema = z.string().uuid("Collaborator not found.");
export const createInviteSchema = z.object({ projectId: projectIdSchema });
export const revokeInviteSchema = z.object({ projectId: projectIdSchema, inviteId: inviteIdSchema });
export const acceptInviteSchema = z.object({ token: inviteTokenSchema });
export const removeCollaboratorSchema = z.object({ projectId: projectIdSchema, userId: memberUserIdSchema });

export const leaseTargetTypeSchema = z.enum(["page", "building_block"]);
export const leaseTargetSchema = z.object({
  projectId: projectIdSchema,
  targetType: leaseTargetTypeSchema,
  targetId: z.string().uuid("Lease target is invalid."),
});
