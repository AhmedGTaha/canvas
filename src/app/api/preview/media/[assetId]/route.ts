import { PreviewManifestService } from "@/generated-runtime/manifest/service";
import { MediaService } from "@/domain/media/service";

export async function GET(request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  try {
    const token = new URL(request.url).searchParams.get("token");
    if (!token) throw new Error("Missing token");
    const payload = await new PreviewManifestService().authorizeToken(token);
    const { assetId } = await params;
    const { asset, bytes } = await new MediaService().readBinary(payload.userId, assetId);
    if (asset.projectId !== payload.projectId) throw new Error("Wrong project");
    return new Response(Buffer.from(bytes), { headers: { "Content-Type": asset.mimeType, "Content-Length": String(asset.sizeBytes), "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "cross-origin", "Content-Disposition": "inline" } });
  } catch { return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "cross-origin" } }); }
}
