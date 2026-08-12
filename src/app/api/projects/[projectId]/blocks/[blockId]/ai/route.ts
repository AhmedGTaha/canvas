import { GenerationJobService } from "@/domain/ai/job-service";
import { getCurrentUser } from "@/server/auth/session";
import { blockErrorResponse, blockJsonHeaders } from "../../response";

type Context = { params: Promise<{ projectId: string; blockId: string }> };

export async function GET(_request: Request, { params }: Context) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const { projectId, blockId } = await params;
    return Response.json(await new GenerationJobService().getBlockState(user.id, projectId, blockId), { headers: blockJsonHeaders });
  } catch (error) { return blockErrorResponse(error, "Building Block history could not be loaded."); }
}

export async function POST(request: Request, { params }: Context) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const { projectId, blockId } = await params;
    const body = await request.json() as { content?: unknown; selectedMediaIds?: unknown; selection?: unknown };
    return Response.json(await new GenerationJobService().createBlockJob(user.id, { projectId, blockId, content: body.content, selectedMediaIds: body.selectedMediaIds, selection: body.selection ?? null }), { status: 201, headers: blockJsonHeaders });
  } catch (error) { return blockErrorResponse(error, "Canvas could not start this Building Block update."); }
}
