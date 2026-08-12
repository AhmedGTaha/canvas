import { MediaService } from "@/domain/media/service";
import { userMessage } from "@/domain/shared/errors";
import { getCurrentUser } from "@/server/auth/session";

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  try {
    const { projectId } = await params;
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "Choose an image to upload." }, { status: 400 });
    const asset = await new MediaService().upload(user.id, { projectId, folderId: String(form.get("folderId") || "") || null, filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    return Response.json({ asset }, { status: 201 });
  } catch (error: unknown) { return Response.json({ error: userMessage(error, "Upload failed.") }, { status: 400 }); }
}
