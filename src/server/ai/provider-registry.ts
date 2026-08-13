import type { AIProvider } from "@/domain/ai/provider";
import { aiProviderCredentials } from "./config";
import { GeminiProvider } from "./gemini-provider";

/**
 * Resolves the server-configured AI provider. Credentials come only from server
 * environment variables; Canvas never accepts a key from a client or the database.
 */
export function getAIProvider(): AIProvider {
  const { apiKey, model, timeoutMs } = aiProviderCredentials();
  return new GeminiProvider(apiKey, model, timeoutMs);
}
