import { ZodError } from "zod";
import { AIFollowUpService } from "@/domain/ai-queue/service";
import { userMessage } from "@/domain/shared/errors";
import { getCurrentUser } from "@/server/auth/session";
type Context = { params: Promise<{ projectId: string; itemId: string }> };
export async function PATCH(request: Request, { params }: Context) { const user = await getCurrentUser(); if (!user) return Response.json({ error: "Authentication required." }, { status: 401 }); try { const { projectId, itemId } = await params; return Response.json(await new AIFollowUpService().edit(user.id, projectId, itemId, await request.json())); } catch (error) { return Response.json({ error: error instanceof ZodError ? error.issues[0]?.message : userMessage(error, "This follow-up could not be edited.") }, { status: 400 }); } }
export async function DELETE(_request: Request, { params }: Context) { const user = await getCurrentUser(); if (!user) return Response.json({ error: "Authentication required." }, { status: 401 }); try { const { projectId, itemId } = await params; return Response.json(await new AIFollowUpService().cancel(user.id, projectId, itemId)); } catch (error) { return Response.json({ error: userMessage(error, "This follow-up could not be cancelled.") }, { status: 400 }); } }
