import { DomainError, type DomainErrorCode } from "@/domain/shared/errors";

export type HistoryErrorCode =
  | "NOTHING_TO_UNDO" | "NOTHING_TO_REDO" | "UNDO_CONFLICT" | "REDO_CONFLICT"
  | "VERSION_NOT_FOUND" | "RESTORE_INVALID" | "CHECKPOINT_NOT_FOUND"
  | "CHANGE_SET_NOT_FOUND" | "HISTORY_CROSS_PROJECT_REFERENCE";

/**
 * Normalized, user-safe history failures. `code` keeps the existing transport behaviour
 * of DomainError while `historyCode` gives clients a stable machine-readable reason.
 */
export class HistoryError extends DomainError {
  constructor(public readonly historyCode: HistoryErrorCode, code: DomainErrorCode, message: string, public readonly detail?: string) {
    super(code, message);
    this.name = "HistoryError";
  }
}

export const nothingToUndo = () => new HistoryError("NOTHING_TO_UNDO", "CONFLICT", "There is nothing to undo.");
export const nothingToRedo = () => new HistoryError("NOTHING_TO_REDO", "CONFLICT", "There is nothing to redo.");
export const undoConflict = () => new HistoryError("UNDO_CONFLICT", "CONFLICT", "Someone made newer changes to this work. Use Version History or a checkpoint to go back safely.");
export const redoConflict = () => new HistoryError("REDO_CONFLICT", "CONFLICT", "Newer changes were made since this was undone, so it can no longer be redone.");
export const versionNotFound = () => new HistoryError("VERSION_NOT_FOUND", "NOT_FOUND", "That version is not part of this item.");
export const checkpointNotFound = () => new HistoryError("CHECKPOINT_NOT_FOUND", "NOT_FOUND", "That checkpoint is not part of this project.");
export const restoreInvalid = (message: string, detail?: string) => new HistoryError("RESTORE_INVALID", "VALIDATION", message, detail);
