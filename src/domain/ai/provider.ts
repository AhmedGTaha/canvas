export type AIErrorCode =
  | "AI_PROVIDER_UNAVAILABLE" | "AI_PROVIDER_AUTH_FAILED" | "AI_PROVIDER_RATE_LIMITED"
  | "AI_PROVIDER_TIMEOUT" | "AI_PROVIDER_INVALID_RESPONSE" | "AI_CONTEXT_TOO_LARGE"
  | "AI_JOB_CANCELLED" | "AI_INTERNAL_ERROR" | "AI_NOT_CONFIGURED"
  | "AI_PAGE_STALE" | "AI_PAGE_CONFLICT"
  | "AI_BLOCK_STALE" | "AI_BLOCK_CONFLICT";

export class AIError extends Error {
  constructor(public readonly code: AIErrorCode, message: string, public readonly retryable = false, public readonly retryAfterMs?: number, public readonly diagnostic?: string) {
    super(message);
    this.name = "AIError";
  }
}

export type AIContentPart = { type: "text"; text: string } | { type: "image"; mimeType: string; data: Uint8Array };
export type AIProviderMessage = { role: "user" | "assistant"; parts: AIContentPart[] };
export type AIUsage = { inputTokens?: number; outputTokens?: number; totalTokens?: number; cachedTokens?: number };

export type AIRequest = {
  systemInstructions: string;
  messages: AIProviderMessage[];
  structuredContext?: unknown;
  responseSchema?: unknown;
  temperature?: number;
  maxOutputTokens?: number;
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
};

export interface StructuredValidator<T> { parse(value: unknown): T }

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  generateText(request: AIRequest): Promise<AIResponse>;
  generateStructured<T>(request: AIRequest, validator: StructuredValidator<T>): Promise<AIResponse<T>>;
  cancel?(requestId: string): Promise<void>;
}
