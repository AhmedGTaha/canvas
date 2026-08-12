import { DomainError, type DomainErrorCode } from "@/domain/shared/errors";

export type BlockErrorCode =
  | "BLOCK_NOT_FOUND" | "BLOCK_DELETED" | "BLOCK_IN_USE" | "BLOCK_GENERATION_ACTIVE"
  | "BLOCK_STALE" | "BLOCK_VALIDATION_FAILED" | "BLOCK_COMPILE_FAILED" | "BLOCK_MEDIA_INVALID"
  | "BLOCK_REFERENCE_INVALID" | "BLOCK_CROSS_PROJECT_REFERENCE" | "BLOCK_LEASE_CONFLICT"
  | "BLOCK_CANCELLED" | "BLOCK_GLOBAL_CONVERSION_FAILED" | "BLOCK_NOT_GENERATED";

/**
 * Normalized, user-safe Building Block failures. `code` keeps the existing transport
 * behaviour of DomainError while `blockCode` gives clients a stable machine-readable
 * reason. Internal SQL, storage keys, and provider payloads never reach either field.
 */
export class BlockError extends DomainError {
  constructor(public readonly blockCode: BlockErrorCode, code: DomainErrorCode, message: string) {
    super(code, message);
    this.name = "BlockError";
  }
}

export const blockNotFound = () => new BlockError("BLOCK_NOT_FOUND", "NOT_FOUND", "Building Block not found.");
export const blockDeleted = () => new BlockError("BLOCK_DELETED", "NOT_FOUND", "This Building Block was archived.");
export const blockInUse = (pageCount: number) => new BlockError("BLOCK_IN_USE", "CONFLICT", `This Building Block is still used by ${pageCount} ${pageCount === 1 ? "page" : "pages"}. Remove it from those pages first.`);
export const blockGenerationActive = () => new BlockError("BLOCK_GENERATION_ACTIVE", "CONFLICT", "Canvas is already updating this Building Block.");
export const blockReferenceInvalid = () => new BlockError("BLOCK_REFERENCE_INVALID", "VALIDATION", "This page references a Building Block that is not available.");
export const blockNotGenerated = () => new BlockError("BLOCK_NOT_GENERATED", "CONFLICT", "Create this Building Block with Canvas before using it.");
export const blockGlobalConversionFailed = (message: string) => new BlockError("BLOCK_GLOBAL_CONVERSION_FAILED", "CONFLICT", message);
