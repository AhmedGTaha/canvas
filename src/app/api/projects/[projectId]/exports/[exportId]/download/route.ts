import { ExportService } from "@/domain/export/export-service";
import { getCurrentUser } from "@/server/auth/session";
import { apiErrorResponse } from "@/server/http/errors";

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string; exportId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const { projectId, exportId } = await params;
    // Project-scoped and completion-gated; the storage key never reaches the client.
    const artifact = await new ExportService().download(user.id, projectId, exportId);
    return new Response(artifact.bytes as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Length": String(artifact.bytes.byteLength),
        "Content-Disposition": `attachment; filename="${artifact.fileName.replace(/[^A-Za-z0-9._-]/g, "-")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'",
      },
    });
  } catch (error) { return apiErrorResponse(error, "This export could not be downloaded."); }
}
