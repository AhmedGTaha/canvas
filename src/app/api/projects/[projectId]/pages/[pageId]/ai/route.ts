import { ZodError } from "zod";
import { GenerationJobService } from "@/domain/ai/job-service";
import { AIError } from "@/domain/ai/provider";
import { userMessage } from "@/domain/shared/errors";
import { getCurrentUser } from "@/server/auth/session";

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string; pageId: string }> }) {
  const user = await getCurrentUser(); if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  try { const { projectId, pageId } = await params; return Response.json(await new GenerationJobService().getPageState(user.id, projectId, pageId), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return Response.json({ error: userMessage(error, "Page AI state could not be loaded.") }, { status: 404 }); }
}

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string; pageId: string }> }) {
  const user = await getCurrentUser(); if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  try {
    const { projectId, pageId } = await params;
    const body = await request.json() as { content?: unknown; selectedMediaIds?: unknown; selection?: unknown };
    // The selected element is untrusted: the service resolves it against the manifest of
    // the version that is active right now before any of it reaches the model.
    const result = await new GenerationJobService().createPageJob(user.id, { projectId, pageId, content: body.content, selectedMediaIds: body.selectedMediaIds, selection: body.selection ?? null });
    return Response.json(result, { status: 201 });
  }
  catch (error) {
    if (error instanceof AIError) return Response.json({ error: error.message, code: error.code }, { status: 400 });
    return Response.json({ error: error instanceof ZodError ? (error.issues[0]?.message ?? "Check your request.") : userMessage(error, "Canvas could not start this page update.") }, { status: 400 });
  }
}
