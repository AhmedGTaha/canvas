import { BuildingBlockService } from "@/domain/blocks/service";
import { getCurrentUser } from "@/server/auth/session";
import { blockErrorResponse, blockJsonHeaders } from "../../response";

export async function POST(_request: Request, { params }: { params: Promise<{ projectId: string; blockId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const { projectId, blockId } = await params;
    return Response.json(await new BuildingBlockService().duplicate(user.id, { projectId, blockId }), { status: 201, headers: blockJsonHeaders });
  } catch (error) { return blockErrorResponse(error, "This Building Block could not be duplicated."); }
}
