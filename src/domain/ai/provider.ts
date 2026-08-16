export type AIErrorCode =
  | "AI_PROVIDER_UNAVAILABLE" | "AI_PROVIDER_AUTH_FAILED" | "AI_PROVIDER_RATE_LIMITED"
  | "AI_PROVIDER_TIMEOUT" | "AI_PROVIDER_INVALID_RESPONSE" | "AI_CONTEXT_TOO_LARGE"
  | "AI_RESPONSE_EMPTY" | "AI_RESPONSE_TRUNCATED" | "AI_RESPONSE_MALFORMED" | "AI_RESPONSE_SCHEMA_INVALID"
  | "AI_GENERATED_SOURCE_INVALID"
  | "AI_JOB_CANCELLED" | "AI_INTERNAL_ERROR" | "AI_NOT_CONFIGURED"
  | "AI_MODEL_CAPABILITY_UNSUPPORTED" | "AI_MODEL_LISTING_UNSUPPORTED"
  | "AI_PAGE_STALE" | "AI_PAGE_CONFLICT"
  | "AI_BLOCK_STALE" | "AI_BLOCK_CONFLICT"
  | "AI_ELEMENT_STALE" | "AI_ELEMENT_NOT_FOUND" | "AI_ELEMENT_INVALID";

export class AIError extends Error {
  constructor(public readonly code: AIErrorCode, message: string, public readonly retryable = false, public readonly retryAfterMs?: number, public readonly diagnostic?: string) {
    super(message);
    this.name = "AIError";
  }
}

/** Providers Canvas can talk to. Adapters are the only place provider specifics live. */
export type AIProviderKind = "gemini" | "openai" | "anthropic" | "openai_compatible";

export type AIContentPart = { type: "text"; text: string } | { type: "image"; mimeType: string; data: Uint8Array };
export type AIProviderMessage = { role: "user" | "assistant"; parts: AIContentPart[] };
export type AIUsage = { inputTokens?: number; outputTokens?: number; totalTokens?: number; cachedTokens?: number };

/**
 * What a model can do, in Canvas's own terms. Orchestration reads only this: it never
 * branches on a model name or a provider SDK's feature flags.
 */
export type ModelCapabilities = {
  structuredOutput: boolean;
  vision: boolean;
  contextWindow?: number;
  maxOutputTokens?: number;
};

/** A model as a provider reports it, or as an owner entered it by hand. */
export type ProviderModelDescriptor = {
  modelId: string;
  displayName: string;
  capabilities?: Partial<ModelCapabilities>;
};

/** Canvas-owned timing for one provider round trip. Never a whole job's duration. */
export type AITiming = { providerLatencyMs: number };

/** Provider-reported cost, when a provider actually reports one. */
export type AIReportedCost = { amount: number; currency: string };

export type AIRequest = {
  systemInstructions: string;
  messages: AIProviderMessage[];
  structuredContext?: unknown;
  responseSchema?: unknown;
  temperature?: number;
  maxOutputTokens?: number;
  /** Provider-side reasoning tokens to allow. Counts against `maxOutputTokens`. */
  reasoningBudget?: number;
  requestMetadata?: Record<string, string>;
  signal?: AbortSignal;
};

export type AIResponse<T = unknown> = {
  text: string;
  structuredData?: T;
  provider: string;
  model: string;
  providerRequestId?: string;
  usage?: AIUsage;
  finishReason?: string;
  timing?: AITiming;
  /** Set only when the provider itself returns a charge for the request. */
  reportedCost?: AIReportedCost;
};

export interface StructuredValidator<T> { parse(value: unknown): T }

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  readonly capabilities: ModelCapabilities;
  generateText(request: AIRequest): Promise<AIResponse>;
  generateStructured<T>(request: AIRequest, validator: StructuredValidator<T>): Promise<AIResponse<T>>;
  /** Model discovery, where the provider exposes it. */
  listModels?(): Promise<ProviderModelDescriptor[]>;
  cancel?(requestId: string): Promise<void>;
}

/** Everything an adapter needs to be constructed, resolved fresh for each request. */
export type ProviderConnectionConfig = {
  provider: AIProviderKind;
  apiKey: string;
  baseUrl?: string | null;
  model: string;
  capabilities: ModelCapabilities;
  timeoutMs: number;
};

export const DEFAULT_MODEL_CAPABILITIES: ModelCapabilities = { structuredOutput: true, vision: false };

/**
 * Fails a request that needs something the selected model cannot do, rather than
 * silently dropping the part of the request that needs it.
 */
export function requireModelCapability(capabilities: ModelCapabilities, capability: "structuredOutput" | "vision", model: string) {
  if (capabilities[capability]) return;
  const label = capability === "vision" ? "image input" : "structured JSON output";
  throw new AIError("AI_MODEL_CAPABILITY_UNSUPPORTED", `The selected model does not support ${label}. Choose a different model in AI settings.`, false, undefined, `model=${model} capability=${capability}`);
}
