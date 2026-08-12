import { copyName } from "@/domain/pages/slug";

/**
 * Picks the first non-conflicting "<name> Copy" variant. Block identity is the UUID,
 * so names only need to stay readable and distinct inside the library.
 */
export function duplicateBlockName(baseName: string, existingNames: Iterable<string>) {
  const taken = new Set([...existingNames].map((name) => name.trim().toLowerCase()));
  for (let copyNumber = 1; copyNumber < 1_000; copyNumber += 1) {
    const candidate = copyName(baseName, copyNumber).slice(0, 120).trim();
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${baseName} Copy`.slice(0, 120);
}

/**
 * Copies only the parts of a Block Version manifest that stay valid for a new,
 * independent block. Source stays authoritative in `source_code`.
 */
export function duplicateBlockManifest(manifest: unknown) {
  if (!manifest || typeof manifest !== "object") return { schemaVersion: 1, runtimeVersion: 1 };
  const source = manifest as Record<string, unknown>;
  return {
    schemaVersion: 1,
    runtimeVersion: 1,
    sourceHash: typeof source.sourceHash === "string" ? source.sourceHash : undefined,
    referencedMediaIds: Array.isArray(source.referencedMediaIds) ? source.referencedMediaIds.filter((id): id is string => typeof id === "string") : [],
    internalRoutes: Array.isArray(source.internalRoutes) ? source.internalRoutes.filter((route): route is string => typeof route === "string") : [],
    externalLinks: Array.isArray(source.externalLinks) ? source.externalLinks.filter((link): link is string => typeof link === "string") : [],
    usesClientInteractivity: source.usesClientInteractivity === true,
    blockUsages: [],
    duplicatedFromVersionId: typeof source.id === "string" ? source.id : undefined,
  };
}
