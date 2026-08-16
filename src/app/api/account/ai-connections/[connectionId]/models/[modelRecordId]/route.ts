import { AIConnectionService } from "@/domain/ai/connections/connection-service";
import { apiErrorResponse, apiJsonHeaders, requireUser } from "@/server/http/errors";
import { getCurrentUser } from "@/server/auth/session";

export async function PATCH(request: Request, { params }: { params: Promise<{ modelRecordId: string }> }) {
  try {
    const user = await requireUser(getCurrentUser);
    const { modelRecordId } = await params;
    const body = await request.json() as Record<string, unknown>;
    const model = await new AIConnectionService().updateModel(user.id, { ...body, modelRecordId });
    return Response.json({ model }, { headers: apiJsonHeaders });
  } catch (error) { return apiErrorResponse(error, "This model could not be updated."); }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ modelRecordId: string }> }) {
  try {
    const user = await requireUser(getCurrentUser);
    const { modelRecordId } = await params;
    return Response.json(await new AIConnectionService().removeModel(user.id, modelRecordId), { headers: apiJsonHeaders });
  } catch (error) { return apiErrorResponse(error, "This model could not be removed."); }
}
