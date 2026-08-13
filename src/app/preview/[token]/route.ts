import { randomBytes } from "node:crypto";
import { z } from "zod";
import { PreviewManifestService } from "@/generated-runtime/manifest/service";
import { renderBlockPreviewDocument, renderPreviewDocument, renderPreviewErrorDocument } from "@/generated-runtime/preview/render-document";
import { previewSecurityHeaders } from "@/generated-runtime/security/headers";
import { initialPreviewRoute, normalizePreviewRoute } from "@/generated-runtime/runtime/router";
import { GeneratedPageContentProvider } from "@/generated-runtime/preview/generated-page-provider";
import { BuildingBlockContentProvider } from "@/domain/blocks/preview";
import { PreviewError, previewNotFound } from "@/generated-runtime/preview/errors";
import { observe } from "@/server/observability/events";
import { errorCode } from "@/server/observability/telemetry";

const querySchema = z.object({ route: z.string().max(1000).optional(), mode: z.enum(["light", "dark"]).optional(), instance: z.uuid(), block: z.uuid().optional() }).strict();

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const nonce = randomBytes(18).toString("base64url");
  const canvasOrigin = process.env.APP_URL || new URL(request.url).origin;
  const headers = { ...previewSecurityHeaders(nonce, canvasOrigin), "Content-Type": "text/html; charset=utf-8" };
  let errorContext: { sessionId: string; instanceId: string; parentOrigin: string; route: string; pageId: string | null } | undefined;
  try {
    const { token } = await params;
    const url = new URL(request.url);
    const query = querySchema.parse({ route: url.searchParams.get("route") || undefined, mode: url.searchParams.get("mode") || undefined, instance: url.searchParams.get("instance"), block: url.searchParams.get("block") || undefined });
    const { payload, manifest } = await new PreviewManifestService().fromToken(token);

    if (query.block) {
      errorContext = { sessionId: manifest.previewSessionId, instanceId: query.instance, parentOrigin: canvasOrigin, route: "/", pageId: null };
      const entry = manifest.blocks[query.block];
      if (!entry) throw previewNotFound("block is not part of this project preview");
      const compiled = entry.activeVersionId ? await new BuildingBlockContentProvider().getActive(payload.projectId, entry.id) : null;
      const document = renderBlockPreviewDocument({ manifest, nonce, parentOrigin: canvasOrigin, instanceId: query.instance, initialMode: query.mode ?? "light", block: { id: entry.id, name: entry.name, contentStatus: entry.contentStatus }, blockBundle: compiled?.bundle });
      return new Response(document, { headers });
    }

    const route = query.route ? normalizePreviewRoute(query.route) : initialPreviewRoute(manifest);
    const page = manifest.pages.find((item) => item.pageId === manifest.routes[route]?.pageId);
    errorContext = { sessionId: manifest.previewSessionId, instanceId: query.instance, parentOrigin: canvasOrigin, route, pageId: page?.pageId ?? null };
    const generated = page?.currentVersionId ? await new GeneratedPageContentProvider().get(payload.projectId, page.pageId, page.currentVersionId) : null;
    const html = renderPreviewDocument({ manifest, nonce, parentOrigin: canvasOrigin, instanceId: query.instance, initialRoute: route, initialMode: query.mode ?? "light", generatedBundle: generated?.bundle });
    return new Response(html, { headers });
  } catch (error) {
    // The reason is recorded operationally and shown as a plain sentence in the frame,
    // instead of a blanket "Preview could not be loaded." with nothing behind it.
    const preview = error instanceof PreviewError ? error : null;
    observe.previewSessionFailed({ code: errorCode(error), reason: preview?.detail });
    const status = preview?.previewCode === "PREVIEW_NOT_CONFIGURED" ? 500 : preview?.previewCode === "PREVIEW_COMPILE_FAILED" ? 422 : 403;
    const code = preview?.previewCode ?? "PREVIEW_UNAVAILABLE";
    return new Response(renderPreviewErrorDocument({
      nonce,
      message: preview?.message ?? "This preview could not be loaded. Return to Canvas and refresh the preview.",
      diagnostic: errorContext ? { ...errorContext, code } : undefined,
    }), { status, headers });
  }
}
