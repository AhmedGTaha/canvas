import { HistoryService } from "@/domain/history/undo-service";
import { getCurrentUser } from "@/server/auth/session";
import { apiErrorResponse, apiJsonHeaders } from "@/server/http/errors";

export async function POST(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const { projectId } = await params;
    const result = await new HistoryService().undo(user.id, projectId);
    return Response.json({ changeSetId: result.changeSet.id, summary: result.changeSet.summary, source: result.source }, { headers: apiJsonHeaders });
  } catch (error) { return apiErrorResponse(error, "This change could not be undone."); }
}
