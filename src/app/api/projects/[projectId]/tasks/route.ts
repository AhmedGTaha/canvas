import { TaskService } from "@/domain/tasks/service";
import { userMessage } from "@/domain/shared/errors";
import { getCurrentUser } from "@/server/auth/session";

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const user = await getCurrentUser(); if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  try { const { projectId } = await params; return Response.json({ tasks: await new TaskService().list(user.id, projectId) }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return Response.json({ error: userMessage(error, "Background work could not be loaded.") }, { status: 404 }); }
}
