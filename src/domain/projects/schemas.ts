import { z } from "zod";
import { workspaceIdSchema } from "@/domain/workspaces/schemas";

export const projectStatusSchema = z.enum(["active", "archived", "deleted"]);
export const projectIdSchema = z.string().uuid("Project not found.");
export const projectNameSchema = z.string().trim().min(1, "Enter a project name.").max(100, "Project name must be 100 characters or fewer.");
export const projectDescriptionSchema = z.string().trim().max(500, "Description must be 500 characters or fewer.").transform((value) => value || null);
export const createProjectSchema = z.object({
  workspaceId: workspaceIdSchema,
  name: projectNameSchema,
  description: projectDescriptionSchema.optional().default(""),
});
export const renameProjectSchema = z.object({ id: projectIdSchema, name: projectNameSchema });
