import { randomBytes } from "node:crypto";
import { z } from "zod";
import { PreviewManifestService } from "@/generated-runtime/manifest/service";
import { renderPreviewDocument } from "@/generated-runtime/preview/render-document";
import { previewSecurityHeaders } from "@/generated-runtime/security/headers";
import { initialPreviewRoute, normalizePreviewRoute } from "@/generated-runtime/runtime/router";

const querySchema = z.object({ route: z.string().max(1000).optional(), mode: z.enum(["light", "dark"]).optional(), instance: z.uuid() }).strict();

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const nonce = randomBytes(18).toString("base64url");
  const canvasOrigin = process.env.APP_URL || new URL(request.url).origin;
  try {
    const { token } = await params;
    const url = new URL(request.url);
    const query = querySchema.parse({ route: url.searchParams.get("route") || undefined, mode: url.searchParams.get("mode") || undefined, instance: url.searchParams.get("instance") });
    const { manifest } = await new PreviewManifestService().fromToken(token);
    const route = query.route ? normalizePreviewRoute(query.route) : initialPreviewRoute(manifest);
    const html = renderPreviewDocument({ manifest, nonce, parentOrigin: canvasOrigin, instanceId: query.instance, initialRoute: route, initialMode: query.mode ?? "light" });
    return new Response(html, { headers: { ...previewSecurityHeaders(nonce, canvasOrigin), "Content-Type": "text/html; charset=utf-8" } });
  } catch {
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style nonce="${nonce}">body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fafafa;color:#27272a;font:14px system-ui}.error{max-width:360px;padding:24px;text-align:center}.error h1{font-size:18px}.error p{color:#71717a}</style></head><body><div class="error"><h1>Preview could not be loaded.</h1><p>Return to Canvas and refresh the preview.</p></div></body></html>`;
    return new Response(html, { status: 403, headers: { ...previewSecurityHeaders(nonce, canvasOrigin), "Content-Type": "text/html; charset=utf-8" } });
  }
}
