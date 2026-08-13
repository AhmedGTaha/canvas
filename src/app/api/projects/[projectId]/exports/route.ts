import { ExportService } from "@/domain/export/export-service";
import { getCurrentUser } from "@/server/auth/session";
import { apiErrorResponse, apiJsonHeaders } from "@/server/http/errors";

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const { projectId } = await params;
    return Response.json({ exports: await new ExportService().list(user.id, projectId) }, { headers: apiJsonHeaders });
  } catch (error) { return apiErrorResponse(error, "Exports could not be loaded."); }
}

export async function POST(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const { projectId } = await params;
    const job = await new ExportService().create(user.id, projectId);
    return Response.json({ id: job.id, status: job.status, progressStage: job.progressStage }, { status: 201, headers: apiJsonHeaders });
  } catch (error) { return apiErrorResponse(error, "This export could not be started."); }
}
