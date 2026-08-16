import { AIConnectionService } from "@/domain/ai/connections/connection-service";
import { apiErrorResponse, apiJsonHeaders, requireUser } from "@/server/http/errors";
import { getCurrentUser } from "@/server/auth/session";

/** Adds a model by hand, for providers or endpoints with no usable model list. */
export async function POST(request: Request, { params }: { params: Promise<{ connectionId: string }> }) {
  try {
    const user = await requireUser(getCurrentUser);
    const { connectionId } = await params;
    const body = await request.json() as Record<string, unknown>;
    const model = await new AIConnectionService().addModel(user.id, { ...body, connectionId });
    return Response.json({ model }, { status: 201, headers: apiJsonHeaders });
  } catch (error) { return apiErrorResponse(error, "This model could not be added."); }
}
