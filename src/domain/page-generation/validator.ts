import { compileGeneratedSource, type GeneratedBlockModule } from "@/domain/generated-source/compiler";
import { validateGeneratedSource, type GeneratedBlockUsage, type GeneratedSourceManifest } from "@/domain/generated-source/validator";

export type GeneratedPageManifest = GeneratedSourceManifest;
export type { GeneratedBlockUsage };

/** Page-specific wrapper over the shared generated-source security policy. */
export function validateGeneratedPageSource(input: {
  sourceCode: string;
  approvedMediaIds: Set<string>;
  activeRoutes: Set<string>;
  declaredMediaIds?: string[];
  availableBlockIds?: Set<string>;
  declaredBlockUsages?: GeneratedBlockUsage[];
  blockSources?: Map<string, string>;
}) {
  return validateGeneratedSource({ kind: "page", ...input });
}

/** Compiles an active Page Version together with the Building Blocks it references. */
export function compileGeneratedPage(sourceCode: string, blocks: GeneratedBlockModule[] = []) {
  return compileGeneratedSource({ entrySource: sourceCode, blocks });
}
