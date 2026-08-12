import { CheckpointService } from "@/domain/history/checkpoint-service";
import { getCurrentUser } from "@/server/auth/session";
import { apiErrorResponse, apiJsonHeaders } from "@/server/http/errors";

export async function POST(_request: Request, { params }: { params: Promise<{ projectId: string; checkpointId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const { projectId, checkpointId } = await params;
    const result = await new CheckpointService().restore(user.id, projectId, checkpointId);
    return Response.json({ changeSetId: result.changeSet.id, name: result.checkpoint.name, restored: result.restored, skipped: result.skipped }, { headers: apiJsonHeaders });
  } catch (error) { return apiErrorResponse(error, "This checkpoint could not be restored."); }
}
