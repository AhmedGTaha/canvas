import { VersionRestoreService } from "@/domain/history/restore-service";
import { getCurrentUser } from "@/server/auth/session";
import { apiErrorResponse, apiJsonHeaders } from "@/server/http/errors";

export async function POST(_request: Request, { params }: { params: Promise<{ projectId: string; blockId: string; versionId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const { projectId, blockId, versionId } = await params;
    const result = await new VersionRestoreService().restoreBlockVersion(user.id, projectId, blockId, versionId);
    return Response.json({ changeSetId: result.changeSet.id, versionId: result.version.id, versionNumber: result.version.versionNumber }, { headers: apiJsonHeaders });
  } catch (error) { return apiErrorResponse(error, "This version could not be restored."); }
}
