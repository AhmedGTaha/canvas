import { AIAnalyticsService, parseAnalyticsPeriod } from "@/domain/ai/analytics/analytics-service";
import { apiErrorResponse, apiJsonHeaders, requireUser } from "@/server/http/errors";
import { getCurrentUser } from "@/server/auth/session";

/**
 * Project-scoped AI activity: what this website has generated, how it performed, and what
 * it cost, across everyone who worked on it. Configuration is not here — a credential
 * belongs to the person who spends it, so that lives on the account.
 *
 * Authorization is enforced inside the service.
 */
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const user = await requireUser(getCurrentUser);
    const { projectId } = await params;
    const period = parseAnalyticsPeriod(new URL(request.url).searchParams.get("period"));
    return Response.json(await new AIAnalyticsService().summary(user.id, projectId, period), { headers: apiJsonHeaders });
  } catch (error) { return apiErrorResponse(error, "AI analytics could not be loaded."); }
}
