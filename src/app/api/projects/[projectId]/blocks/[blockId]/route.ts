import { BuildingBlockService } from "@/domain/blocks/service";
import { getCurrentUser } from "@/server/auth/session";
import { blockErrorResponse, blockJsonHeaders } from "../response";

type Context = { params: Promise<{ projectId: string; blockId: string }> };

export async function GET(_request: Request, { params }: Context) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const { projectId, blockId } = await params;
    const service = new BuildingBlockService();
    const { block, version } = await service.read(user.id, projectId, blockId);
    const usages = await service.listUsages(user.id, projectId, blockId);
    return Response.json({ block, version: version ? { id: version.id, versionNumber: version.versionNumber, changeSummary: version.changeSummary, createdAt: version.createdAt } : null, usages }, { headers: blockJsonHeaders });
  } catch (error) { return blockErrorResponse(error, "Building Block not found."); }
}

export async function PATCH(request: Request, { params }: Context) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const { projectId, blockId } = await params;
    const body = await request.json() as { name?: unknown; kind?: unknown; isGlobal?: unknown };
    const service = new BuildingBlockService();
    let block = await service.update(user.id, { projectId, blockId, name: body.name, kind: body.kind });
    // Global status changes reference semantics, so it goes through the transactional
    // conversion path rather than a blind boolean write.
    if (typeof body.isGlobal === "boolean") block = await service.setGlobal(user.id, { projectId, blockId, isGlobal: body.isGlobal });
    return Response.json(block, { headers: blockJsonHeaders });
  } catch (error) { return blockErrorResponse(error, "This Building Block could not be updated."); }
}

export async function DELETE(_request: Request, { params }: Context) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const { projectId, blockId } = await params;
    return Response.json(await new BuildingBlockService().archive(user.id, { projectId, blockId }), { headers: blockJsonHeaders });
  } catch (error) { return blockErrorResponse(error, "This Building Block could not be archived."); }
}
