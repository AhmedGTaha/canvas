import { DomainError, type DomainErrorCode } from "@/domain/shared/errors";
import { legacyVersionMessage } from "@/domain/generated-source/stored-version";

export type PreviewErrorCode =
  | "PREVIEW_NOT_CONFIGURED" | "PREVIEW_SESSION_INVALID" | "PREVIEW_ACCESS_DENIED"
  | "PREVIEW_NOT_FOUND" | "PREVIEW_DOCUMENT_UNREADABLE" | "PREVIEW_LEGACY_DOCUMENT" | "PREVIEW_RUNTIME_FAILED";

/**
 * Normalized, user-safe Preview failures.
 *
 * Every Preview failure used to collapse into a single opaque "Preview error" with no
 * diagnostic anywhere. These codes let the API, the UI, and telemetry all say the same
 * specific thing without exposing secrets, tokens, storage keys, or stack traces.
 */
export class PreviewError extends DomainError {
  constructor(public readonly previewCode: PreviewErrorCode, code: DomainErrorCode, message: string, public readonly detail?: string) {
    super(code, message);
    this.name = "PreviewError";
  }
}

export const previewNotConfigured = (detail: string) =>
  new PreviewError("PREVIEW_NOT_CONFIGURED", "VALIDATION", "Preview is not set up for this environment yet. Ask an administrator to finish the Canvas configuration.", detail);
export const previewSessionInvalid = () =>
  new PreviewError("PREVIEW_SESSION_INVALID", "ACCESS_DENIED", "This preview session expired. Refresh the preview to continue.");
export const previewNotFound = (detail?: string) =>
  new PreviewError("PREVIEW_NOT_FOUND", "NOT_FOUND", "This preview is not available.", detail);
export const previewDocumentUnreadable = (detail?: string) =>
  new PreviewError("PREVIEW_DOCUMENT_UNREADABLE", "VALIDATION", "Canvas could not display this content. Ask Canvas to update it, or restore an earlier version.", detail);

/**
 * A Version stored before generated websites became static documents. It is deliberately
 * not rendered: turning a compiled React component back into markup would mean executing
 * model-authored code, so the honest outcome is to say so and offer the way forward.
 */
export const previewLegacyDocument = () =>
  new PreviewError("PREVIEW_LEGACY_DOCUMENT", "VALIDATION", legacyVersionMessage, "version predates the static document format");

/** Plain-language reason for a Preview that could not be prepared. Never leaks internals. */
export function previewUnavailableMessage(error: unknown) {
  if (error instanceof PreviewError) return error.message;
  if (error instanceof DomainError) return error.message;
  return "Preview could not be prepared. Try again.";
}
