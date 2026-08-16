import { validateGeneratedDocument, type GeneratedSourceManifest } from "@/domain/generated-source/validator";
import type { GeneratedDocument } from "@/domain/generated-source/document";

export type GeneratedBlockManifest = GeneratedSourceManifest;

/**
 * Building Block wrapper over the shared generated-document security policy. Blocks may
 * not nest other blocks, so a `data-canvas-block` reference is rejected inside a block.
 */
export function validateGeneratedBlockDocument(input: {
  document: GeneratedDocument;
  approvedMediaIds: Set<string>;
  activeRoutes: Set<string>;
  declaredMediaIds?: string[];
}) {
  return validateGeneratedDocument({ kind: "block", ...input });
}
