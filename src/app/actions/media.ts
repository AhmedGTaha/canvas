"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { MediaService } from "@/domain/media/service";
import { userMessage } from "@/domain/shared/errors";
import { requireAuthenticatedUser } from "@/server/auth/session";

export type MediaActionResult = { ok: true; message: string } | { ok: false; error: string };

export async function mediaAction(input: { projectId: string; intent: string; folderId?: string; parentId?: string | null; assetId?: string; name?: string; direction?: "up" | "down"; displayName?: string; altText?: string | null }): Promise<MediaActionResult> {
  try {
    const user = await requireAuthenticatedUser();
    const service = new MediaService();
    if (input.intent === "create-folder") await service.createFolder(user.id, { projectId: input.projectId, parentId: input.parentId, name: input.name });
    else if (input.intent === "rename-folder") await service.renameFolder(user.id, { projectId: input.projectId, folderId: input.folderId, name: input.name });
    else if (input.intent === "move-folder") await service.moveFolder(user.id, { projectId: input.projectId, folderId: input.folderId, parentId: input.parentId });
    else if (input.intent === "reorder-folder") await service.reorderFolder(user.id, { projectId: input.projectId, folderId: input.folderId, direction: input.direction });
    else if (input.intent === "delete-folder") await service.deleteFolder(user.id, { projectId: input.projectId, folderId: input.folderId });
    else if (input.intent === "update-asset") await service.updateAsset(user.id, { projectId: input.projectId, assetId: input.assetId, displayName: input.displayName, altText: input.altText });
    else if (input.intent === "move-asset") await service.moveAsset(user.id, { projectId: input.projectId, assetId: input.assetId, folderId: input.folderId ?? null });
    else if (input.intent === "delete-asset") await service.deleteAsset(user.id, { projectId: input.projectId, assetId: input.assetId });
    else return { ok: false, error: "This media action is not supported." };
    revalidatePath(`/projects/${input.projectId}`);
    return { ok: true, message: "Changes saved." };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof ZodError ? (error.issues[0]?.message ?? "The media change is invalid.") : userMessage(error, "The media change could not be saved.") };
  }
}

export async function setBrandLogoAction(input: { projectId: string; kind: "primary" | "alternate"; assetId: string | null }): Promise<MediaActionResult> {
  try {
    const user = await requireAuthenticatedUser();
    await new MediaService().setBrandLogo(user.id, input);
    revalidatePath(`/projects/${input.projectId}`);
    return { ok: true, message: "Logo selection saved." };
  } catch (error: unknown) { return { ok: false, error: userMessage(error, "Logo selection could not be saved.") }; }
}
