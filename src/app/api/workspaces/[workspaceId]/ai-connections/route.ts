import { AIConnectionService } from "@/domain/ai/connections/connection-service";
import { apiErrorResponse, apiJsonHeaders, requireUser } from "@/server/http/errors";
import { getCurrentUser } from "@/server/auth/session";

/**
 * Workspace AI connections. Every response here is masked: a stored API key is never
 * returned, in whole or in part, only its provider, its name, and a four-character hint.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  try {
    const user = await requireUser(getCurrentUser);
    const { workspaceId } = await params;
    return Response.json({ connections: await new AIConnectionService().list(user.id, workspaceId) }, { headers: apiJsonHeaders });
  } catch (error) { return apiErrorResponse(error, "AI connections could not be loaded."); }
}

export async function POST(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  try {
    const user = await requireUser(getCurrentUser);
    const { workspaceId } = await params;
    const body = await request.json() as Record<string, unknown>;
    const connection = await new AIConnectionService().create(user.id, { ...body, workspaceId });
    return Response.json({ connection }, { status: 201, headers: apiJsonHeaders });
  } catch (error) { return apiErrorResponse(error, "This AI connection could not be saved."); }
}
