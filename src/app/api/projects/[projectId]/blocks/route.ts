import { BuildingBlockService } from "@/domain/blocks/service";
import { getCurrentUser } from "@/server/auth/session";
import { blockErrorResponse, blockJsonHeaders } from "./response";

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const { projectId } = await params;
    const search = new URL(request.url).searchParams.get("search") || undefined;
    return Response.json({ blocks: await new BuildingBlockService().list(user.id, { projectId, search }) }, { headers: blockJsonHeaders });
  } catch (error) { return blockErrorResponse(error, "Building Blocks could not be loaded."); }
}

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const { projectId } = await params;
    const body = await request.json() as { name?: unknown; kind?: unknown; isGlobal?: unknown };
    // The project always comes from the authenticated route, never from the request body.
    const block = await new BuildingBlockService().create(user.id, { projectId, name: body.name, kind: body.kind ?? "custom", isGlobal: body.isGlobal ?? false });
    return Response.json(block, { status: 201, headers: blockJsonHeaders });
  } catch (error) { return blockErrorResponse(error, "This Building Block could not be created."); }
}
