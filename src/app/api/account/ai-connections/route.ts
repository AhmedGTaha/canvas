import { AIConnectionService } from "@/domain/ai/connections/connection-service";
import { apiErrorResponse, apiJsonHeaders, requireUser } from "@/server/http/errors";
import { getCurrentUser } from "@/server/auth/session";

/**
 * This account's AI connections.
 *
 * There is no account parameter, by design: the only connections reachable from here are
 * the caller's own. Every response is masked — a stored API key is never returned, in
 * whole or in part, only its provider, its name, and a four-character hint.
 */
export async function GET() {
  try {
    const user = await requireUser(getCurrentUser);
    return Response.json({ connections: await new AIConnectionService().list(user.id) }, { headers: apiJsonHeaders });
  } catch (error) { return apiErrorResponse(error, "AI connections could not be loaded."); }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(getCurrentUser);
    const body = await request.json() as Record<string, unknown>;
    const connection = await new AIConnectionService().create(user.id, body);
    return Response.json({ connection }, { status: 201, headers: apiJsonHeaders });
  } catch (error) { return apiErrorResponse(error, "This AI connection could not be saved."); }
}
