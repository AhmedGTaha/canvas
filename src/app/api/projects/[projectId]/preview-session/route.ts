import { PreviewManifestService } from "@/generated-runtime/manifest/service";
import { PreviewError } from "@/generated-runtime/preview/errors";
import { getCurrentUser } from "@/server/auth/session";
import { apiErrorResponse, apiJsonHeaders } from "@/server/http/errors";
import { observe } from "@/server/observability/events";
import { errorCode } from "@/server/observability/telemetry";

export async function POST(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const { projectId } = await params;
  try {
    return Response.json(await new PreviewManifestService().createSession(user.id, projectId), { headers: apiJsonHeaders });
  } catch (error) {
    // A preview session that cannot be created is an operational signal, not a silent
    // 404: the reason is recorded and a normalized code reaches the client.
    observe.previewSessionFailed({ projectId, code: errorCode(error), reason: error instanceof PreviewError ? error.detail : undefined });
    return apiErrorResponse(error, "Preview could not be prepared.");
  }
}
