import { ExportService } from "@/domain/export/export-service";
import { getCurrentUser } from "@/server/auth/session";
import { apiErrorResponse, apiJsonHeaders } from "@/server/http/errors";

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string; exportId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const { projectId, exportId } = await params;
    return Response.json(await new ExportService().get(user.id, projectId, exportId), { headers: apiJsonHeaders });
  } catch (error) { return apiErrorResponse(error, "That export could not be loaded."); }
}
