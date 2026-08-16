import { ProjectModelService } from "@/domain/ai/connections/project-model-service";
import { apiErrorResponse, apiJsonHeaders, requireUser } from "@/server/http/errors";
import { getCurrentUser } from "@/server/auth/session";

/** The project's AI model selection and the models its workspace has enabled. */
export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const user = await requireUser(getCurrentUser);
    const { projectId } = await params;
    return Response.json(await new ProjectModelService().read(user.id, projectId), { headers: apiJsonHeaders });
  } catch (error) { return apiErrorResponse(error, "AI settings could not be loaded."); }
}

export async function PUT(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const user = await requireUser(getCurrentUser);
    const { projectId } = await params;
    const body = await request.json() as { connectionId?: string | null; modelRecordId?: string | null };
    const selection = await new ProjectModelService().select(user.id, { projectId, connectionId: body.connectionId ?? null, modelRecordId: body.modelRecordId ?? null });
    return Response.json(selection, { headers: apiJsonHeaders });
  } catch (error) { return apiErrorResponse(error, "This model selection could not be saved."); }
}
