import { TextEditService } from "@/domain/generated-source/text-edit-service";
import { getCurrentUser } from "@/server/auth/session";
import { blockErrorResponse, blockJsonHeaders } from "../../response";
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string; blockId: string }> }) { const user = await getCurrentUser(); if (!user) return Response.json({ error: "Authentication required." }, { status: 401 }); try { const { projectId, blockId } = await params; return Response.json(await new TextEditService().saveBlock(user.id, { ...await request.json(), projectId, targetId: blockId }), { headers: blockJsonHeaders }); } catch (error) { return blockErrorResponse(error, "That text could not be saved."); } }
