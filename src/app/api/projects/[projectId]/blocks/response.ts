import { ZodError } from "zod";
import { DomainError } from "@/domain/shared/errors";
import { BlockError } from "@/domain/blocks/errors";

const STATUS: Record<string, number> = {
  AUTHENTICATION_REQUIRED: 401, ACCESS_DENIED: 403, NOT_FOUND: 404,
  CONFLICT: 409, RATE_LIMITED: 429, VALIDATION: 400,
};

/**
 * Normalized, user-safe Building Block API failures. Internal SQL, storage keys, stack
 * traces, and provider responses never reach the client.
 */
export function blockErrorResponse(error: unknown, fallback: string) {
  if (error instanceof ZodError) return Response.json({ error: error.issues[0]?.message ?? "Check your request.", code: "BLOCK_VALIDATION_FAILED" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  if (error instanceof BlockError) return Response.json({ error: error.message, code: error.blockCode }, { status: STATUS[error.code] ?? 400, headers: { "Cache-Control": "no-store" } });
  if (error instanceof DomainError) return Response.json({ error: error.message, code: error.code }, { status: STATUS[error.code] ?? 400, headers: { "Cache-Control": "no-store" } });
  return Response.json({ error: fallback }, { status: 400, headers: { "Cache-Control": "no-store" } });
}

export const blockJsonHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } as const;
