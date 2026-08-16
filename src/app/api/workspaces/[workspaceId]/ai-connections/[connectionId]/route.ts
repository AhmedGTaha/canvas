import { AIConnectionService } from "@/domain/ai/connections/connection-service";
import { apiErrorResponse, apiJsonHeaders, requireUser } from "@/server/http/errors";
import { getCurrentUser } from "@/server/auth/session";

export async function PATCH(request: Request, { params }: { params: Promise<{ connectionId: string }> }) {
  try {
    const user = await requireUser(getCurrentUser);
    const { connectionId } = await params;
    const body = await request.json() as Record<string, unknown>;
    // An absent apiKey means "keep the stored credential": the browser never had it.
    const connection = await new AIConnectionService().update(user.id, { ...body, connectionId });
    return Response.json({ connection }, { headers: apiJsonHeaders });
  } catch (error) { return apiErrorResponse(error, "This AI connection could not be updated."); }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ connectionId: string }> }) {
  try {
    const user = await requireUser(getCurrentUser);
    const { connectionId } = await params;
    return Response.json(await new AIConnectionService().remove(user.id, connectionId), { headers: apiJsonHeaders });
  } catch (error) { return apiErrorResponse(error, "This AI connection could not be removed."); }
}
