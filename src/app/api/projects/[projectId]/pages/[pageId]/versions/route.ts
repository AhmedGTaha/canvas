import { VersionRestoreService } from "@/domain/history/restore-service";
import { getCurrentUser } from "@/server/auth/session";
import { apiErrorResponse, apiJsonHeaders } from "@/server/http/errors";

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string; pageId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const { projectId, pageId } = await params;
    return Response.json(await new VersionRestoreService().listPageVersions(user.id, projectId, pageId), { headers: apiJsonHeaders });
  } catch (error) { return apiErrorResponse(error, "Version history could not be loaded."); }
}
