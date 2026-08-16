import { AITestConsoleService } from "@/domain/ai/connections/test-console-service";
import { apiErrorResponse, apiJsonHeaders, requireUser } from "@/server/http/errors";
import { getCurrentUser } from "@/server/auth/session";

/**
 * The test-model console. It mutates nothing: no page version, no Change Set, no
 * generation job, and no AI conversation message. It can only ever spend the caller's own
 * credential, because that is the only one resolution can reach. Rate limiting is
 * enforced in the service, so nobody reaches a provider through here unchecked.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser(getCurrentUser);
    const body = await request.json() as { prompt?: unknown };
    return Response.json(await new AITestConsoleService().run(user.id, { prompt: body.prompt }), { headers: apiJsonHeaders });
  } catch (error) { return apiErrorResponse(error, "This test request could not be sent."); }
}
