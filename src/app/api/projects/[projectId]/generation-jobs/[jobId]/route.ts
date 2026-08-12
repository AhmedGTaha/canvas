import { GenerationJobService } from "@/domain/ai/job-service";
import { userMessage } from "@/domain/shared/errors";
import { getCurrentUser } from "@/server/auth/session";

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string; jobId: string }> }) {
  const user = await getCurrentUser(); if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  try { const { projectId, jobId } = await params; return Response.json(await new GenerationJobService().get(user.id, projectId, jobId), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return Response.json({ error: userMessage(error, "Generation job not found.") }, { status: 404 }); }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ projectId: string; jobId: string }> }) {
  const user = await getCurrentUser(); if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  try { const { projectId, jobId } = await params; return Response.json(await new GenerationJobService().requestCancellation(user.id, projectId, jobId)); }
  catch (error) { return Response.json({ error: userMessage(error, "This job could not be cancelled.") }, { status: 400 }); }
}
