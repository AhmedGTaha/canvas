import { compileGeneratedSource } from "@/domain/generated-source/compiler";
import { validateGeneratedSource, type GeneratedSourceManifest } from "@/domain/generated-source/validator";

export type GeneratedBlockManifest = GeneratedSourceManifest;

/**
 * Building Block wrapper over the shared generated-source security policy. Blocks may
 * not nest other blocks, so `CanvasBlock` is rejected inside block source.
 */
export function validateGeneratedBlockSource(input: {
  sourceCode: string;
  approvedMediaIds: Set<string>;
  activeRoutes: Set<string>;
  declaredMediaIds?: string[];
}) {
  return validateGeneratedSource({ kind: "block", ...input });
}

export function compileGeneratedBlock(sourceCode: string) {
  return compileGeneratedSource({ entrySource: sourceCode });
}
