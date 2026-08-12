import { PreviewManifestService } from "@/generated-runtime/manifest/service";
import { getCurrentUser } from "@/server/auth/session";

export async function POST(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const { projectId } = await params;
    const session = await new PreviewManifestService().createSession(user.id, projectId);
    return Response.json(session, { headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch { return Response.json({ error: "Preview could not be prepared." }, { status: 404, headers: { "Cache-Control": "no-store" } }); }
}
