import { DomainError } from "@/domain/shared/errors";
import { readStoredDocument, type GeneratedDocument } from "./document";

/**
 * Reading a stored Version's content, across the one format change this table has had.
 *
 * `react_tsx` rows were written when a generated page was a React component Canvas
 * compiled. They are kept exactly as they were — history, Change Sets, and Checkpoints
 * still reference them — but they cannot be rendered, exported, or handed to a model as
 * the baseline for an edit, because converting arbitrary React to markup would mean
 * executing it. Every path that needs content therefore has to ask for it through here
 * and handle the "this version predates the static format" answer explicitly.
 */
export const LEGACY_SOURCE_FORMAT = "react_tsx" as const;
export const STATIC_SOURCE_FORMAT = "static_html" as const;

export type StoredVersionRow = { sourceFormat: string; document: unknown };

export function isLegacyVersion(version: StoredVersionRow | null | undefined) {
  return Boolean(version) && version!.sourceFormat === LEGACY_SOURCE_FORMAT;
}

/** The document of a static Version, or null for a legacy or unreadable row. */
export function versionDocument(version: StoredVersionRow | null | undefined): GeneratedDocument | null {
  if (!version || version.sourceFormat !== STATIC_SOURCE_FORMAT) return null;
  return readStoredDocument(version.document);
}

export const legacyVersionMessage =
  "This page was built with an earlier version of Canvas and cannot be displayed or edited. Ask Canvas to rebuild it to bring it up to date.";

export function legacyVersionError() {
  return new DomainError("VALIDATION", legacyVersionMessage);
}

/**
 * The document of a Version that must have one. Callers that cannot proceed without
 * content use this so the legacy case surfaces as a specific, actionable failure rather
 * than an empty page.
 */
export function requireVersionDocument(version: StoredVersionRow | null | undefined): GeneratedDocument {
  const document = versionDocument(version);
  if (!document) throw legacyVersionError();
  return document;
}
