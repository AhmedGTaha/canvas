import type { MediaResolver } from "@/domain/generated-source/composition";
import type { ProjectPreviewManifest } from "../manifest/schema";

/**
 * Media for the Preview frame.
 *
 * A generated document names Media by UUID and never by URL, so the only place a URL is
 * produced is here, from the manifest built for this Preview session. The URL it hands
 * back is the session-scoped `/api/preview/media/:id` route with the session token — never
 * a storage key, a signed provider URL, or a filesystem path — and a document that names
 * Media outside the session's own library simply resolves to nothing.
 */
export function previewMediaResolver(manifest: ProjectPreviewManifest): MediaResolver {
  return (mediaId) => {
    const asset = manifest.media[mediaId];
    return asset ? { url: asset.previewUrl, width: asset.width, height: asset.height, altText: asset.altText } : null;
  };
}
