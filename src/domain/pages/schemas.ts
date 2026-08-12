import { z } from "zod";
import { projectIdSchema } from "@/domain/projects/schemas";

export const nodeIdSchema = z.string().uuid("Page or folder not found.");
export const nodeNameSchema = z.string().trim().min(1, "Enter a name.").max(120, "Name must be 120 characters or fewer.");
export const slugSchema = z.string().trim().toLowerCase().min(1, "Enter a URL slug.").max(100, "URL slug must be 100 characters or fewer.").regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and single hyphens only.");
const nullableParent = z.union([nodeIdSchema, z.literal(""), z.null()]).optional().transform((value) => value || null);

export const createNodeSchema = z.object({
  projectId: projectIdSchema,
  parentId: nullableParent,
  type: z.enum(["page", "folder"]),
  name: nodeNameSchema,
  slug: z.union([slugSchema, z.literal(""), z.null()]).optional().transform((value) => value || null),
});
export const renameNodeSchema = z.object({ projectId: projectIdSchema, nodeId: nodeIdSchema, name: nodeNameSchema });
export const moveNodeSchema = z.object({ projectId: projectIdSchema, nodeId: nodeIdSchema, newParentId: nullableParent, newPosition: z.coerce.number().int().min(0) });
export const reorderNodeSchema = z.object({ projectId: projectIdSchema, nodeId: nodeIdSchema, direction: z.enum(["up", "down"]) });
export const pageMutationSchema = z.object({ projectId: projectIdSchema, nodeId: nodeIdSchema });
export const updateSlugSchema = pageMutationSchema.extend({ slug: slugSchema });
export const updateSeoSchema = pageMutationSchema.extend({
  pageTitle: z.string().trim().max(100, "Page title must be 100 characters or fewer.").transform((value) => value || null),
  metaDescription: z.string().trim().max(300, "Meta description must be 300 characters or fewer.").transform((value) => value || null),
});
