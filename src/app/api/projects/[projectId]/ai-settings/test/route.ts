import { AITestConsoleService } from "@/domain/ai/connections/test-console-service";
import { apiErrorResponse, apiJsonHeaders, requireUser } from "@/server/http/errors";
import { getCurrentUser } from "@/server/auth/session";

/**
 * The test-model console. It mutates nothing: no page version, no Change Set, no
 * generation job, and no AI conversation message. Authorization and rate limiting are
 * enforced in the service, so no caller can reach the provider through here unchecked.
 */
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const user = await requireUser(getCurrentUser);
    const { projectId } = await params;
    const body = await request.json() as { prompt?: unknown };
    return Response.json(await new AITestConsoleService().run(user.id, { projectId, prompt: body.prompt }), { headers: apiJsonHeaders });
  } catch (error) { return apiErrorResponse(error, "This test request could not be sent."); }
}
