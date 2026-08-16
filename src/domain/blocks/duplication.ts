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
 * The name a *new* block should take.
 *
 * Different from `duplicateBlockName` on purpose: duplicating always means "another copy
 * of this", so it always says Copy. Installing a section from the Canvas library the
 * first time is not a copy of anything the project has, so calling it "Classic bar Copy"
 * is simply wrong. Later installs of the same starter fall back to a numeric suffix.
 */
export function uniqueBlockName(baseName: string, existingNames: Iterable<string>) {
  const taken = new Set([...existingNames].map((name) => name.trim().toLowerCase()));
  const base = baseName.slice(0, 120).trim();
  if (!taken.has(base.toLowerCase())) return base;
  for (let index = 2; index < 1_000; index += 1) {
    const candidate = `${base} ${index}`.slice(0, 120).trim();
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return duplicateBlockName(base, existingNames);
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
