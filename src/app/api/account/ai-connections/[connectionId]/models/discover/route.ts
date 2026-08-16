import { AIConnectionService } from "@/domain/ai/connections/connection-service";
import { apiErrorResponse, apiJsonHeaders, requireUser } from "@/server/http/errors";
import { consumeRateLimit } from "@/server/rate-limit/service";
import { getCurrentUser } from "@/server/auth/session";

/** Model discovery against the provider, where the provider supports listing models. */
export async function POST(_request: Request, { params }: { params: Promise<{ connectionId: string }> }) {
  try {
    const user = await requireUser(getCurrentUser);
    const { connectionId } = await params;
    await consumeRateLimit("ai_model_discovery", `${user.id}:${connectionId}`, { attempts: 12, windowMinutes: 15 });
    return Response.json(await new AIConnectionService().discoverModels(user.id, connectionId), { headers: apiJsonHeaders });
  } catch (error) { return apiErrorResponse(error, "Models could not be loaded from this connection."); }
}
