"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { PageTreeService } from "@/domain/pages/service";
import { userMessage } from "@/domain/shared/errors";
import { requireAuthenticatedUser } from "@/server/auth/session";

export type TreeActionState = { error?: string; success?: string };

export async function pageTreeAction(_state: TreeActionState, formData: FormData): Promise<TreeActionState> {
  const projectId = String(formData.get("projectId") ?? "");
  const intent = String(formData.get("intent") ?? "");
  const service = new PageTreeService();
  try {
    const user = await requireAuthenticatedUser();
    if (intent === "create") await service.create(user.id, { projectId, parentId: formData.get("parentId"), type: formData.get("type"), name: formData.get("name"), slug: formData.get("slug") });
    else if (intent === "rename") await service.rename(user.id, { projectId, nodeId: formData.get("nodeId"), name: formData.get("name") });
    else if (intent === "slug") await service.updateSlug(user.id, { projectId, nodeId: formData.get("nodeId"), slug: formData.get("slug") });
    else if (intent === "seo") await service.updateSeo(user.id, { projectId, nodeId: formData.get("nodeId"), pageTitle: formData.get("pageTitle"), metaDescription: formData.get("metaDescription") });
    else if (intent === "move") await service.move(user.id, { projectId, nodeId: formData.get("nodeId"), newParentId: formData.get("newParentId"), newPosition: formData.get("newPosition") });
    else if (intent === "reorder") await service.reorder(user.id, { projectId, nodeId: formData.get("nodeId"), direction: formData.get("direction") });
    else if (intent === "homepage") await service.setHomepage(user.id, { projectId, nodeId: formData.get("nodeId") });
    else if (intent === "duplicate") await service.duplicatePage(user.id, { projectId, nodeId: formData.get("nodeId") });
    else if (intent === "delete") await service.deleteSubtree(user.id, { projectId, nodeId: formData.get("nodeId") });
    else return { error: "This page action is not supported." };
    revalidatePath(`/projects/${projectId}/pages`);
    return { success: "Changes saved." };
  } catch (error: unknown) {
    if (error instanceof ZodError) return { error: error.issues[0]?.message ?? "Changes could not be saved." };
    return { error: userMessage(error, "Changes could not be saved.") };
  }
}
