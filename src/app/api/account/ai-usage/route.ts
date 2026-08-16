import { AIAnalyticsService, parseAnalyticsPeriod } from "@/domain/ai/analytics/analytics-service";
import { apiErrorResponse, apiJsonHeaders, requireUser } from "@/server/http/errors";
import { getCurrentUser } from "@/server/auth/session";

/**
 * This account's own AI usage and cost, across every project it has worked in.
 *
 * Attribution follows the credential: the rows counted here are the ones this person's
 * key paid for. No other account's usage is reachable from this route.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser(getCurrentUser);
    const period = parseAnalyticsPeriod(new URL(request.url).searchParams.get("period"));
    return Response.json(await new AIAnalyticsService().accountSummary(user.id, period), { headers: apiJsonHeaders });
  } catch (error) { return apiErrorResponse(error, "AI usage could not be loaded."); }
}
