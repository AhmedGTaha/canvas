import { TextEditService } from "@/domain/generated-source/text-edit-service";
import { getCurrentUser } from "@/server/auth/session";
import { apiErrorResponse, apiJsonHeaders } from "@/server/http/errors";
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string; pageId: string }> }) { const user = await getCurrentUser(); if (!user) return Response.json({ error: "Authentication required." }, { status: 401 }); try { const { projectId, pageId } = await params; return Response.json(await new TextEditService().savePage(user.id, { ...await request.json(), projectId, targetId: pageId }), { headers: apiJsonHeaders }); } catch (error) { return apiErrorResponse(error, "That text could not be saved."); } }
