import { z } from "zod";

export const workspaceIdSchema = z.string().uuid("Workspace not found.");
export const workspaceNameSchema = z.string().trim().min(1, "Enter a workspace name.").max(100, "Workspace name must be 100 characters or fewer.");
export const createWorkspaceSchema = z.object({ name: workspaceNameSchema });
export const renameWorkspaceSchema = z.object({ id: workspaceIdSchema, name: workspaceNameSchema });
