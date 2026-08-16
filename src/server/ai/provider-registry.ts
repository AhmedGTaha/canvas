import type { AIProvider, AIProviderKind, ModelCapabilities, ProviderConnectionConfig } from "@/domain/ai/provider";
import { GeminiProvider } from "./gemini-provider";
import { OpenAIProvider, OPENAI_DEFAULT_BASE_URL } from "./openai-provider";
import { AnthropicProvider, ANTHROPIC_DEFAULT_BASE_URL } from "./anthropic-provider";
import { OpenCodeProvider, OPENCODE_DEFAULT_BASE_URL } from "./opencode-provider";

/**
 * The provider registry.
 *
 * Adding a provider means adding an adapter and one entry here. Canvas domain code
 * resolves a project's connection to a `ProviderConnectionConfig` and asks this registry
 * for an adapter; nothing outside `src/server/ai` knows which SDK or wire protocol is
 * involved, and no provider-specific branch exists in generation orchestration.
 */
export type ProviderDescriptor = {
  kind: AIProviderKind;
  label: string;
  /** A base URL is meaningful for this provider, and required where noted. */
  baseUrl: { supported: boolean; required: boolean; default?: string; placeholder?: string };
  supportsModelListing: boolean;
  /** What Canvas assumes about a model added by hand, before an owner edits it. */
  defaultCapabilities: ModelCapabilities;
  credentialLabel: string;
  help: string;
};

export const PROVIDER_DESCRIPTORS: Record<AIProviderKind, ProviderDescriptor> = {
  gemini: {
    kind: "gemini", label: "Google Gemini",
    baseUrl: { supported: false, required: false },
    supportsModelListing: true,
    defaultCapabilities: { structuredOutput: true, vision: true },
    credentialLabel: "API key",
    help: "Create a key in Google AI Studio.",
  },
  openai: {
    kind: "openai", label: "OpenAI",
    baseUrl: { supported: true, required: false, default: OPENAI_DEFAULT_BASE_URL, placeholder: OPENAI_DEFAULT_BASE_URL },
    supportsModelListing: true,
    defaultCapabilities: { structuredOutput: true, vision: true },
    credentialLabel: "API key",
    help: "Create a key in the OpenAI dashboard.",
  },
  anthropic: {
    kind: "anthropic", label: "Anthropic",
    baseUrl: { supported: true, required: false, default: ANTHROPIC_DEFAULT_BASE_URL, placeholder: ANTHROPIC_DEFAULT_BASE_URL },
    supportsModelListing: true,
    defaultCapabilities: { structuredOutput: true, vision: true },
    credentialLabel: "API key",
    help: "Create a key in the Anthropic console.",
  },
  opencode: {
    kind: "opencode", label: "OpenCode Zen",
    baseUrl: { supported: false, required: false, default: OPENCODE_DEFAULT_BASE_URL },
    supportsModelListing: true,
    defaultCapabilities: { structuredOutput: true, vision: false },
    credentialLabel: "OpenCode API key",
    help: "Create an API key in OpenCode Zen. Canvas loads only the free models available to that key.",
  },
  openai_compatible: {
    kind: "openai_compatible", label: "OpenAI-compatible",
    baseUrl: { supported: true, required: true, placeholder: "https://your-endpoint/v1" },
    supportsModelListing: true,
    defaultCapabilities: { structuredOutput: true, vision: false },
    credentialLabel: "API key",
    help: "Any endpoint that speaks the OpenAI Chat Completions API. Model discovery is used when the endpoint offers it; otherwise add model IDs by hand.",
  },
};

export const PROVIDER_KINDS = Object.keys(PROVIDER_DESCRIPTORS) as AIProviderKind[];

export function providerDescriptor(kind: AIProviderKind) { return PROVIDER_DESCRIPTORS[kind]; }

const DEFAULT_TIMEOUT_MS = 120_000;

/** Provider request timeout. The one AI setting that is still environment-level. */
export function providerTimeoutMs(environment: NodeJS.ProcessEnv = process.env) {
  const value = Number(environment.AI_PROVIDER_TIMEOUT_MS);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

/** Builds the adapter for a resolved connection. Credentials live only in this call. */
export function createProvider(config: ProviderConnectionConfig): AIProvider {
  const { apiKey, model, capabilities, timeoutMs, baseUrl } = config;
  switch (config.provider) {
    case "gemini": return new GeminiProvider(apiKey, model, timeoutMs, capabilities);
    case "anthropic": return new AnthropicProvider(apiKey, model, timeoutMs, { baseUrl, capabilities });
    case "openai": return new OpenAIProvider(apiKey, model, timeoutMs, { baseUrl, capabilities, provider: "openai" });
    case "opencode": return new OpenCodeProvider(apiKey, model, timeoutMs, capabilities);
    case "openai_compatible": return new OpenAIProvider(apiKey, model, timeoutMs, { baseUrl, capabilities, provider: "openai_compatible" });
  }
}
