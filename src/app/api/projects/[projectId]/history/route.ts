import { HistoryService } from "@/domain/history/undo-service";
import { getCurrentUser } from "@/server/auth/session";
import { apiErrorResponse, apiJsonHeaders } from "@/server/http/errors";

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const { projectId } = await params;
    return Response.json(await new HistoryService().state(user.id, projectId), { headers: apiJsonHeaders });
  } catch (error) { return apiErrorResponse(error, "Project history could not be loaded."); }
}
