import { validateGeneratedDocument, type GeneratedBlockUsage, type GeneratedSourceManifest } from "@/domain/generated-source/validator";
import type { GeneratedDocument } from "@/domain/generated-source/document";
import type { CompositionFingerprint } from "./composition-fingerprint";
import type { PersistedDesignPlan } from "./design-plan";

/**
 * The page manifest is the shared generated-source manifest plus optional design-plan
 * metadata. The field is optional so legacy pages (and every Building Block) simply omit
 * it, and the deterministic validator never has to know about it.
 */
export type GeneratedPageManifest = GeneratedSourceManifest & {
  designPlan?: PersistedDesignPlan<CompositionFingerprint>;
};
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
