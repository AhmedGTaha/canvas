import { AIConnectionService } from "@/domain/ai/connections/connection-service";
import { apiErrorResponse, apiJsonHeaders, requireUser } from "@/server/http/errors";
import { consumeRateLimit } from "@/server/rate-limit/service";
import { getCurrentUser } from "@/server/auth/session";

/** Live credential check. Rate limited so the button cannot be used as a load generator. */
export async function POST(_request: Request, { params }: { params: Promise<{ connectionId: string }> }) {
  try {
    const user = await requireUser(getCurrentUser);
    const { connectionId } = await params;
    await consumeRateLimit("ai_connection_test", `${user.id}:${connectionId}`, { attempts: 12, windowMinutes: 15 });
    return Response.json(await new AIConnectionService().test(user.id, connectionId), { headers: apiJsonHeaders });
  } catch (error) { return apiErrorResponse(error, "This AI connection could not be tested."); }
}
