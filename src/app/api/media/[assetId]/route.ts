import { MediaService } from "@/domain/media/service";
import { getCurrentUser } from "@/server/auth/session";

export async function GET(_request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Not found", { status: 404 });
  try {
    const { assetId } = await params;
    const { asset, bytes } = await new MediaService().readBinary(user.id, assetId);
    return new Response(Buffer.from(bytes), { headers: { "Content-Type": asset.mimeType, "Content-Length": String(asset.sizeBytes), "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff", "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(asset.originalFilename)}` } });
  } catch { return new Response("Not found", { status: 404 }); }
}
