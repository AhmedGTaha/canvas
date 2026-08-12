import { DomainError } from "@/domain/shared/errors";

export function generateSlug(name: string) {
  const slug = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim()
    .replace(/&/g, " ").replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!slug) throw new DomainError("VALIDATION", "This name cannot produce a valid URL. Enter a custom slug.");
  return slug.slice(0, 100).replace(/-$/g, "");
}

export function copyName(baseName: string, copyNumber: number) {
  return copyNumber === 1 ? `${baseName} Copy` : `${baseName} Copy ${copyNumber}`;
}

export function copySlug(baseSlug: string, copyNumber: number) {
  const suffix = copyNumber === 1 ? "-copy" : `-copy-${copyNumber}`;
  return `${baseSlug.slice(0, 100 - suffix.length).replace(/-$/g, "")}${suffix}`;
}
