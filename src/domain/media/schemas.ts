import { z } from "zod";

const id = z.uuid();
const optionalId = id.nullable().optional().default(null);
const name = z.string().trim().min(1, "A name is required.").max(120);
export const listMediaSchema = z.object({ projectId: id, search: z.string().trim().max(160).optional().default("") });
export const createMediaFolderSchema = z.object({ projectId: id, parentId: optionalId, name });
export const renameMediaFolderSchema = z.object({ projectId: id, folderId: id, name });
export const moveMediaFolderSchema = z.object({ projectId: id, folderId: id, parentId: optionalId });
export const mediaFolderMutationSchema = z.object({ projectId: id, folderId: id });
export const reorderMediaFolderSchema = z.object({ projectId: id, folderId: id, direction: z.enum(["up", "down"]) });
export const assetMutationSchema = z.object({ projectId: id, assetId: id });
export const updateMediaAssetSchema = z.object({ projectId: id, assetId: id, displayName: z.string().trim().min(1).max(160), altText: z.string().trim().max(500).nullable().optional().transform((value) => value || null) });
export const moveMediaAssetSchema = z.object({ projectId: id, assetId: id, folderId: optionalId });
export const setBrandLogoSchema = z.object({ projectId: id, kind: z.enum(["primary", "alternate"]), assetId: id.nullable() });
