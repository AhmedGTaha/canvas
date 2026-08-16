import { validateGeneratedDocument, type GeneratedBlockUsage, type GeneratedSourceManifest } from "@/domain/generated-source/validator";
import type { GeneratedDocument } from "@/domain/generated-source/document";

export type GeneratedPageManifest = GeneratedSourceManifest;
export type { GeneratedBlockUsage };

/** Page-specific wrapper over the shared generated-document security policy. */
export function validateGeneratedPageDocument(input: {
  document: GeneratedDocument;
  approvedMediaIds: Set<string>;
  activeRoutes: Set<string>;
  declaredMediaIds?: string[];
  availableBlockIds?: Set<string>;
  declaredBlockUsages?: GeneratedBlockUsage[];
}) {
  return validateGeneratedDocument({ kind: "page", ...input });
}
