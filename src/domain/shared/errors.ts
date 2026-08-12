export type DomainErrorCode = "AUTHENTICATION_REQUIRED" | "ACCESS_DENIED" | "NOT_FOUND" | "CONFLICT" | "RATE_LIMITED" | "VALIDATION";

export class DomainError extends Error {
  constructor(public readonly code: DomainErrorCode, message: string) {
    super(message);
    this.name = "DomainError";
  }
}

export function userMessage(error: unknown, fallback: string) {
  if (error instanceof DomainError) return error.message;
  return fallback;
}
