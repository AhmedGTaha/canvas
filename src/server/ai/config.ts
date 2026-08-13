import { AIError } from "@/domain/ai/provider";

/**
 * Single source of truth for AI provider configuration.
 *
 * The model name lives here rather than being repeated across job creation and the
 * adapter, so changing models is one environment variable. The API key is read only
 * inside `aiProviderCredentials` and never returned by the descriptor that job records
 * and telemetry use.
 */
export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const DEFAULT_TIMEOUT_MS = 120_000;

function positiveInteger(value: string | undefined, fallback: number) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

/** Provider and model recorded on jobs. Safe to persist and log: never includes a key. */
export function aiProviderDescriptor() {
  return {
    provider: (process.env.AI_PROVIDER ?? "gemini").toLowerCase(),
    // GEMINI_MODEL is the documented setting; AI_MODEL is accepted for compatibility.
    model: process.env.GEMINI_MODEL?.trim() || process.env.AI_MODEL?.trim() || DEFAULT_GEMINI_MODEL,
    timeoutMs: positiveInteger(process.env.AI_PROVIDER_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
  };
}

/**
 * Resolves credentials for a server-side AI call. Throws the normalized configuration
 * error when the environment has no key, so Canvas keeps running without AI.
 */
export function aiProviderCredentials() {
  const descriptor = aiProviderDescriptor();
  if (descriptor.provider !== "gemini") throw new AIError("AI_NOT_CONFIGURED", "AI is not configured for this environment.", false, undefined, `unsupported provider: ${descriptor.provider}`);
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new AIError("AI_NOT_CONFIGURED", "AI is not configured for this environment.", false, undefined, "GEMINI_API_KEY is not set");
  return { ...descriptor, apiKey };
}

/** True when AI features can run. Used for surfacing configuration state, never keys. */
export function isAIConfigured() {
  try { aiProviderCredentials(); return true; } catch { return false; }
}
