import type { ProjectPreviewManifest } from "../manifest/schema";

export type PreviewPageContent = { kind: "placeholder"; heading: string; message: string; editorNodeId: string };
export interface PreviewPageContentProvider { get(pageId: string, manifest: ProjectPreviewManifest): PreviewPageContent | null; }

export class PlaceholderPageContentProvider implements PreviewPageContentProvider {
  get(pageId: string, manifest: ProjectPreviewManifest) {
    const page = manifest.pages.find((candidate) => candidate.pageId === pageId);
    return page ? { kind: "placeholder" as const, heading: page.name, message: "This page is ready to be built. Canvas will display your website content here when it is ready.", editorNodeId: previewEditorNodeId(page.pageId, "placeholder-root") } : null;
  }
}

export function previewEditorNodeId(pageId: string, localId: string) { return `preview:${pageId}:${localId}`; }

// data-canvas-id is editor-only metadata. Customer runtime/export must strip it.
export const CANVAS_EDITOR_ATTRIBUTE = "data-canvas-id" as const;
