import { createHash } from "node:crypto";
import { ZodError } from "zod";
import { AIError } from "@/domain/ai/provider";

/**
 * Provider-neutral failure and response diagnostics.
 *
 * Every adapter maps its own transport onto the same normalized Canvas error model, so
 * orchestration never sees an SDK error, an HTTP status, or a provider's error envelope.
 * Nothing produced here contains a credential, a prompt, or generated source.
 */

/**
 * Redacts anything key-shaped before a provider message becomes a diagnostic.
 *
 * Providers routinely echo the offending credential back inside an authentication error,
 * so this runs on every message before it is stored or logged. `secret` lets an adapter
 * additionally scrub the exact credential it was constructed with, which catches key
 * formats no pattern anticipates.
 */
export function safeDiagnostic(value: unknown, options: { limit?: number; secret?: string } = {}) {
  const { limit = 200, secret } = options;
  const message = value instanceof Error ? value.message : typeof value === "string" ? value : "";
  const scrubbed = secret && secret.length >= 6 ? message.split(secret).join("[redacted]") : message;
  return scrubbed
    .replace(/key=[^&\s]+/gi, "key=[redacted]")
    .replace(/\b(sk|pk|ghp|gho|xai|gsk)[-_][A-Za-z0-9._-]{6,}/gi, "[redacted]")
    .replace(/\bAIza[0-9A-Za-z_-]{10,}/g, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]{8,}/gi, "Bearer [redacted]")
    .slice(0, limit) || undefined;
}

/**
 * Maps an HTTP status and message onto Canvas's normalized AI error model. Retryable
 * failures are transient only: a bad key, a missing model, or a rejected request fails
 * fast instead of being retried three times behind a misleading message.
 */
export function normalizeProviderStatus(status: number | undefined, message: string, provider: string, secret?: string): AIError {
  const detail = safeDiagnostic(`${provider}: ${message}`, { secret });
  if (status === 401 || status === 403 || /invalid[_ ]api[_ ]key|API key not valid|API_KEY_INVALID|PERMISSION_DENIED|UNAUTHENTICATED|authentication/i.test(message)) {
    return new AIError("AI_PROVIDER_AUTH_FAILED", "This AI connection was rejected by the provider. Check its API key in AI settings.", false, undefined, detail);
  }
  if (status === 404 || /model[_ ]not[_ ]found|is not found|does not exist|NOT_FOUND/i.test(message)) {
    return new AIError("AI_NOT_CONFIGURED", "The selected AI model is unavailable from this connection. Choose a different model in AI settings.", false, undefined, detail);
  }
  if (status === 429 || /rate[_ ]limit|RESOURCE_EXHAUSTED|quota/i.test(message)) {
    return new AIError("AI_PROVIDER_RATE_LIMITED", "Canvas AI is busy right now. Try again shortly.", true, retryAfterMs(message), detail);
  }
  if (status === 413 || /token count|context length|too large|exceeds the maximum|too many tokens/i.test(message)) {
    return new AIError("AI_CONTEXT_TOO_LARGE", "This request is too large for the selected model. Try a shorter request or fewer attachments.", false, undefined, detail);
  }
  if (status === 408 || status === 504 || /timeout|timed out|ETIMEDOUT/i.test(message)) {
    return new AIError("AI_PROVIDER_TIMEOUT", "Canvas took too long to generate this. Try again.", true, undefined, detail);
  }
  if (status !== undefined && status >= 500) {
    return new AIError("AI_PROVIDER_UNAVAILABLE", "Canvas AI is temporarily unavailable. Try again shortly.", true, undefined, detail);
  }
  if (status === 400 || /INVALID_ARGUMENT|FAILED_PRECONDITION|invalid[_ ]request/i.test(message)) {
    return new AIError("AI_PROVIDER_INVALID_RESPONSE", "Canvas could not complete this AI request. Try again.", false, undefined, detail);
  }
  return new AIError("AI_PROVIDER_UNAVAILABLE", "Canvas AI is temporarily unavailable. Try again shortly.", true, undefined, detail);
}

function retryAfterMs(message: string) {
  const seconds = /retry[- ]?(?:delay|after)"?\s*[:=]\s*"?(\d+)/i.exec(message);
  return seconds ? Number(seconds[1]) * 1000 : undefined;
}

/** Network-level failure with no HTTP status of its own. */
export function normalizeTransportError(error: unknown, provider: string, secret?: string): AIError {
  if (error instanceof AIError) return error;
  if (error instanceof DOMException && error.name === "AbortError") return new AIError("AI_JOB_CANCELLED", "The AI request was cancelled.");
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/timeout|timed out|ETIMEDOUT|aborted/i.test(message)) return new AIError("AI_PROVIDER_TIMEOUT", "Canvas took too long to generate this. Try again.", true, undefined, safeDiagnostic(message, { secret }));
  return new AIError("AI_PROVIDER_UNAVAILABLE", "Canvas AI is temporarily unavailable. Try again shortly.", true, undefined, safeDiagnostic(`${provider}: ${message}`, { secret }));
}

function fingerprint(label: string, value: string) {
  return `${label}Bytes=${Buffer.byteLength(value, "utf8")} ${label}Sha256=${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

/**
 * Safe diagnostic metadata for a response that cannot become a candidate. Source and
 * prompts must never be logged, so the raw and sanitized payloads are identified only by
 * their sizes and short hashes.
 */
export function structuredResponseDiagnostic(raw: string, sanitized: string, finishReason?: string) {
  return [fingerprint("raw", raw), fingerprint("sanitized", sanitized), finishReason ? `finishReason=${finishReason}` : undefined].filter(Boolean).join(" ");
}

export function schemaDiagnostic(error: unknown) {
  if (!(error instanceof ZodError)) return safeDiagnostic(error);
  return error.issues.slice(0, 6).map((issue) => {
    const path = issue.path.length ? issue.path.join(".") : "root";
    const format = "format" in issue && typeof issue.format === "string" ? `(${issue.format})` : "";
    return `${path}:${issue.code}${format}`;
  }).join(", ");
}

/** Strips a stray markdown fence if a model wraps its JSON despite being asked not to. */
export function unwrapJson(text: string) {
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/i.exec(text.trim());
  return (fenced ? fenced[1]! : text).trim();
}

/** Shared structured-response parsing so every adapter fails identically. */
export function parseStructuredText<T>(text: string, validator: { parse(value: unknown): T }, finishReason?: string): T {
  const sanitized = unwrapJson(text);
  const diagnostic = structuredResponseDiagnostic(text, sanitized, finishReason);
  let parsed: unknown;
  try { parsed = JSON.parse(sanitized); }
  catch { throw new AIError("AI_RESPONSE_MALFORMED", "Canvas AI returned an unreadable response. Try again.", false, undefined, `${diagnostic} stage=response_parse`); }
  try { return validator.parse(parsed); }
  catch (error) {
    throw new AIError("AI_RESPONSE_SCHEMA_INVALID", "Canvas AI returned a response Canvas could not use. Try again.", false, undefined, `${diagnostic} stage=response_schema schemaIssues=${schemaDiagnostic(error)}`);
  }
}
