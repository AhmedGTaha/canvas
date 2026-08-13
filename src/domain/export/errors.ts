import { DomainError, type DomainErrorCode } from "@/domain/shared/errors";
import type { ExportFailure } from "./export-validator";

export type ExportErrorCode =
  | "EXPORT_VALIDATION_FAILED" | "EXPORT_BUILD_FAILED" | "EXPORT_ACTIVE"
  | "EXPORT_NOT_FOUND" | "EXPORT_NOT_READY" | "EXPORT_FAILED";

/** Normalized, user-safe export failures. Storage keys and stack traces never leak. */
export class ExportError extends DomainError {
  constructor(public readonly exportCode: ExportErrorCode, code: DomainErrorCode, message: string, public readonly failures: ExportFailure[] = []) {
    super(code, message);
    this.name = "ExportError";
  }
}

export const exportActive = () => new ExportError("EXPORT_ACTIVE", "CONFLICT", "This project is already being exported. Wait for it to finish.");
export const exportNotFound = () => new ExportError("EXPORT_NOT_FOUND", "NOT_FOUND", "That export is not part of this project.");
export const exportNotReady = () => new ExportError("EXPORT_NOT_READY", "CONFLICT", "This export is not ready to download yet.");
export const exportValidationFailed = (failures: ExportFailure[]) =>
  new ExportError("EXPORT_VALIDATION_FAILED", "VALIDATION", "This website is not ready to export yet. Fix the issues listed and try again.", failures);
export const exportBuildFailed = (failures: ExportFailure[]) =>
  new ExportError("EXPORT_BUILD_FAILED", "VALIDATION", "Canvas could not produce a working website from this project.", failures);
