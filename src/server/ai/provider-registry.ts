import { AIError, type AIProvider } from "@/domain/ai/provider";
import { GeminiProvider } from "./gemini-provider";

function positiveInteger(value: string | undefined, fallback: number) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

export function getAIProvider(): AIProvider {
  const provider = (process.env.AI_PROVIDER ?? "gemini").toLowerCase();
  if (provider !== "gemini") throw new AIError("AI_NOT_CONFIGURED", `Unsupported AI provider: ${provider}.`);
  if (!process.env.GEMINI_API_KEY) throw new AIError("AI_NOT_CONFIGURED", "AI is not configured for this environment.");
  return new GeminiProvider(process.env.GEMINI_API_KEY, process.env.AI_MODEL || "gemini-2.5-flash", positiveInteger(process.env.AI_PROVIDER_TIMEOUT_MS, 120_000));
}
