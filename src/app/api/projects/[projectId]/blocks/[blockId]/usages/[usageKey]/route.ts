import { BuildingBlockService } from "@/domain/blocks/service";
import { getCurrentUser } from "@/server/auth/session";
import { blockErrorResponse, blockJsonHeaders } from "../../../response";

/**
 * Attaches or detaches one page's copy of a Building Block.
 *
 * The page comes in the body rather than the path because a usage key is only
 * unique within a page — the same block is "site-navbar" on every page that
 * uses it — so the key alone does not name a single usage.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ projectId: string; blockId: string; usageKey: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const { projectId, blockId, usageKey } = await params;
    const body = await request.json() as { pageId?: unknown; resolution?: unknown };
    const usage = await new BuildingBlockService().setUsageResolution(user.id, {
      projectId, blockId, usageKey: decodeURIComponent(usageKey), pageId: body.pageId, resolution: body.resolution,
    });
    return Response.json({ usage }, { headers: blockJsonHeaders });
  } catch (error) { return blockErrorResponse(error, "This page's copy of the section could not be changed."); }
}
