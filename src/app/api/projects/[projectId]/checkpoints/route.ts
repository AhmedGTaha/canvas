import { CheckpointService } from "@/domain/history/checkpoint-service";
import { getCurrentUser } from "@/server/auth/session";
import { apiErrorResponse, apiJsonHeaders } from "@/server/http/errors";

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const { projectId } = await params;
    return Response.json({ checkpoints: await new CheckpointService().list(user.id, projectId) }, { headers: apiJsonHeaders });
  } catch (error) { return apiErrorResponse(error, "Checkpoints could not be loaded."); }
}

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const { projectId } = await params;
    const body = await request.json() as { name?: unknown };
    return Response.json(await new CheckpointService().create(user.id, { projectId, name: body.name }), { status: 201, headers: apiJsonHeaders });
  } catch (error) { return apiErrorResponse(error, "This checkpoint could not be created."); }
}
