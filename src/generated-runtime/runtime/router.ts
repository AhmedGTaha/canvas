import type { ProjectPreviewManifest } from "../manifest/schema";

export function normalizePreviewRoute(value: string) {
  try { const path = new URL(value, "https://preview.invalid").pathname.replace(/\/{2,}/g, "/"); return path.length > 1 ? path.replace(/\/$/, "") : "/"; } catch { return "/"; }
}

export function resolvePreviewRoute(manifest: ProjectPreviewManifest, route: string) {
  const path = normalizePreviewRoute(route);
  const entry = manifest.routes[path];
  return { path, page: entry ? manifest.pages.find((page) => page.pageId === entry.pageId) ?? null : null };
}

export function initialPreviewRoute(manifest: ProjectPreviewManifest, selectedPageId?: string | null) {
  const selected = selectedPageId ? manifest.pages.find((page) => page.pageId === selectedPageId) : null;
  return selected?.canonicalRoute ?? manifest.pages.find((page) => page.pageId === manifest.homepage)?.canonicalRoute ?? manifest.pages[0]?.canonicalRoute ?? "/";
}
