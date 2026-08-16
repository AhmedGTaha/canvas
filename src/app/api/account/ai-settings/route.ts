import { AccountModelService } from "@/domain/ai/connections/account-model-service";
import { apiErrorResponse, apiJsonHeaders, requireUser } from "@/server/http/errors";
import { getCurrentUser } from "@/server/auth/session";

/** This account's AI model selection, and the models it has enabled to choose from. */
export async function GET() {
  try {
    const user = await requireUser(getCurrentUser);
    return Response.json(await new AccountModelService().read(user.id), { headers: apiJsonHeaders });
  } catch (error) { return apiErrorResponse(error, "AI settings could not be loaded."); }
}

export async function PUT(request: Request) {
  try {
    const user = await requireUser(getCurrentUser);
    const body = await request.json() as { connectionId?: string | null; modelRecordId?: string | null };
    const selection = await new AccountModelService().select(user.id, { connectionId: body.connectionId ?? null, modelRecordId: body.modelRecordId ?? null });
    return Response.json(selection, { headers: apiJsonHeaders });
  } catch (error) { return apiErrorResponse(error, "This model selection could not be saved."); }
}
