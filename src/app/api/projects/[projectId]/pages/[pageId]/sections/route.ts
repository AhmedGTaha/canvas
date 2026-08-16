import { db } from "@/server/db/client";
import { listPageSectionUsages, PageSectionService } from "@/domain/blocks/page-sections";
import { ProjectAccessService } from "@/server/permissions/project-access";
import { getCurrentUser } from "@/server/auth/session";
import { apiErrorResponse, apiJsonHeaders } from "@/server/http/errors";

/** The reusable sections this page currently uses, in the order they appear on it. */
export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string; pageId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const { projectId, pageId } = await params;
    await new ProjectAccessService().requireProjectAccess(user.id, projectId);
    return Response.json({ sections: await listPageSectionUsages(db, projectId, pageId) }, { headers: apiJsonHeaders });
  } catch (error) { return apiErrorResponse(error, "This page's sections could not be loaded."); }
}

/**
 * Adds a reusable section to this page, producing a new immutable Page Version.
 *
 * `blockId` names a section the project already has; `starterId` names one from the
 * built-in catalog, which is copied into the project inside the same transaction — so a
 * page edit that fails cannot leave a block behind that nobody asked for.
 */
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string; pageId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const { projectId, pageId } = await params;
    const body = await request.json() as { blockId?: unknown; starterId?: unknown; placement?: unknown };
    const result = await new PageSectionService().addSection(user.id, {
      projectId, pageId,
      ...(body.starterId ? { starterId: body.starterId } : { blockId: body.blockId }),
      placement: body.placement ?? { position: "bottom" },
    });
    return Response.json({ section: result }, { headers: apiJsonHeaders });
  } catch (error) { return apiErrorResponse(error, "That section could not be added to this page."); }
}
