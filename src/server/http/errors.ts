import { ZodError } from "zod";
import { DomainError } from "@/domain/shared/errors";
import { BlockError } from "@/domain/blocks/errors";
import { HistoryError } from "@/domain/history/errors";
import { ExportError } from "@/domain/export/errors";
import { AIError } from "@/domain/ai/provider";

const STATUS: Record<string, number> = {
  AUTHENTICATION_REQUIRED: 401, ACCESS_DENIED: 403, NOT_FOUND: 404,
  CONFLICT: 409, RATE_LIMITED: 429, VALIDATION: 400,
};

export const apiJsonHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } as const;

/**
 * Normalized, user-safe API failures. Internal SQL, storage keys, stack traces, and
 * provider responses never reach the client; only the stable code and message do.
 */
export function apiErrorResponse(error: unknown, fallback: string) {
  const json = (body: { error: string; code?: string }, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (error instanceof ZodError) return json({ error: error.issues[0]?.message ?? "Check your request.", code: "VALIDATION" }, 400);
  if (error instanceof AIError) return json({ error: error.message, code: error.code }, 400);
  if (error instanceof ExportError) return Response.json({ error: error.message, code: error.exportCode, failures: error.failures }, { status: STATUS[error.code] ?? 400, headers: { "Cache-Control": "no-store" } });
  if (error instanceof HistoryError) return json({ error: error.message, code: error.historyCode }, STATUS[error.code] ?? 400);
  if (error instanceof BlockError) return json({ error: error.message, code: error.blockCode }, STATUS[error.code] ?? 400);
  if (error instanceof DomainError) return json({ error: error.message, code: error.code }, STATUS[error.code] ?? 400);
  return json({ error: fallback }, 400);
}

export async function requireUser(getCurrentUser: () => Promise<{ id: string } | null>) {
  const user = await getCurrentUser();
  if (!user) throw new DomainError("AUTHENTICATION_REQUIRED", "Authentication required.");
  return user;
}
