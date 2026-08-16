import { AIError, type ModelCapabilities, type ProviderModelDescriptor } from "@/domain/ai/provider";
import { OpenAIProvider } from "./openai-provider";

/** OpenCode Zen's public OpenAI-compatible endpoint. */
export const OPENCODE_DEFAULT_BASE_URL = "https://opencode.ai/zen/v1";

// Zen advertises its temporary free catalogue with this suffix. Big Pickle is the
// current exception, so retain it explicitly while still picking up new `-free` models
// from the live `/models` response without a Canvas deployment.
const FREE_MODEL_IDS = new Set(["big-pickle"]);

export function isOpenCodeFreeModel(modelId: string) {
  return modelId.endsWith("-free") || FREE_MODEL_IDS.has(modelId);
}

/**
 * OpenCode Zen speaks the OpenAI Chat Completions protocol. Its `/models` endpoint also
 * contains paid models, so this adapter intentionally exposes only Zen's free catalogue
 * to Canvas. The filtering happens server-side and never exposes the account key.
 */
export class OpenCodeProvider extends OpenAIProvider {
  constructor(apiKey: string, model: string, timeoutMs: number, capabilities: ModelCapabilities) {
    super(apiKey, model, timeoutMs, { baseUrl: OPENCODE_DEFAULT_BASE_URL, capabilities, provider: "opencode" });
  }

  override async listModels(): Promise<ProviderModelDescriptor[]> {
    const models = await super.listModels();
    const freeModels = models.filter((model) => isOpenCodeFreeModel(model.modelId));
    if (!freeModels.length) {
      throw new AIError("AI_MODEL_LISTING_UNSUPPORTED", "OpenCode did not return any free models for this API key. Check the key or try again later.", false, undefined, "opencode: no free models in /models response");
    }
    return freeModels;
  }
}
