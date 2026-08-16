import { AIError, requireModelCapability, type AIProvider, type AIProviderKind, type AIRequest, type AIResponse, type ModelCapabilities, type ProviderModelDescriptor, type StructuredValidator } from "@/domain/ai/provider";
import { normalizeProviderStatus, normalizeTransportError, parseStructuredText, safeDiagnostic } from "./provider-errors";

export const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string | Array<Record<string, unknown>> };

/** Trailing slashes and an accidental `/chat/completions` suffix are both common. */
export function normalizeBaseUrl(baseUrl: string | null | undefined, fallback: string) {
  const value = (baseUrl ?? "").trim() || fallback;
  return value.replace(/\/+$/, "").replace(/\/chat\/completions$/, "");
}

/**
 * OpenAI Chat Completions adapter, also used for any OpenAI-compatible endpoint.
 *
 * It speaks the wire protocol directly rather than through an SDK, so a self-hosted or
 * third-party compatible endpoint needs nothing but a base URL. Like every adapter it
 * only translates a Canvas `AIRequest` into a request and back: it never reads Canvas
 * persistence, never mutates state, and never logs or returns the API key.
 */
export class OpenAIProvider implements AIProvider {
  readonly name: AIProviderKind;
  readonly capabilities: ModelCapabilities;
  private readonly baseUrl: string;

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly timeoutMs: number,
    options: { baseUrl?: string | null; capabilities?: ModelCapabilities; provider?: AIProviderKind } = {},
  ) {
    this.name = options.provider ?? "openai";
    this.baseUrl = normalizeBaseUrl(options.baseUrl, OPENAI_DEFAULT_BASE_URL);
    this.capabilities = options.capabilities ?? { structuredOutput: true, vision: true };
  }

  private headers() {
    return { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` };
  }

  private async call(path: string, init: RequestInit, signal?: AbortSignal) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new DOMException("Provider timeout", "TimeoutError")), this.timeoutMs);
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers: this.headers(), signal: controller.signal });
      const text = await response.text();
      if (!response.ok) throw normalizeProviderStatus(response.status, providerMessage(text), this.name, this.apiKey);
      try { return JSON.parse(text) as Record<string, unknown>; }
      catch { throw new AIError("AI_RESPONSE_MALFORMED", "Canvas AI returned an unreadable response. Try again.", false, undefined, safeDiagnostic(`${this.name}: non-JSON response body`)); }
    } catch (error) {
      if (controller.signal.aborted && !signal?.aborted) throw new AIError("AI_PROVIDER_TIMEOUT", "Canvas took too long to generate this. Try again.", true);
      if (signal?.aborted) throw new AIError("AI_JOB_CANCELLED", "The AI request was cancelled.");
      throw normalizeTransportError(error, this.name, this.apiKey);
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  }

  async listModels(): Promise<ProviderModelDescriptor[]> {
    const body = await this.call("/models", { method: "GET" });
    const data = Array.isArray(body.data) ? body.data : [];
    const models = data
      .map((entry) => (entry && typeof entry === "object" ? (entry as { id?: unknown }).id : undefined))
      .filter((id): id is string => typeof id === "string" && id.length > 0)
      .map((id) => ({ modelId: id, displayName: id }));
    if (!models.length) throw new AIError("AI_MODEL_LISTING_UNSUPPORTED", "This connection did not return a usable model list. Add model IDs manually.", false, undefined, `${this.name}: empty model list`);
    return models;
  }

  private messages(request: AIRequest): ChatMessage[] {
    const context = request.structuredContext === undefined ? "" : `\n\n<canvas_project_context>\n${JSON.stringify(request.structuredContext)}\n</canvas_project_context>`;
    const conversation = request.messages.map((message, index): ChatMessage => {
      const parts = message.parts.map((part) => part.type === "text"
        // Context leads and the request trails it, so the instruction the model must act
        // on is the last thing it reads.
        ? { type: "text", text: index === 0 ? context + part.text : part.text }
        // Media travels inline as bytes: no storage URL or credential leaves Canvas.
        : { type: "image_url", image_url: { url: `data:${part.mimeType};base64,${Buffer.from(part.data).toString("base64")}` } });
      const onlyText = parts.every((part) => part.type === "text");
      return { role: message.role, content: onlyText ? parts.map((part) => (part as { text: string }).text).join("\n\n") : parts };
    });
    return [{ role: "system", content: request.systemInstructions }, ...conversation];
  }

  private async complete(request: AIRequest, responseFormat?: Record<string, unknown>): Promise<AIResponse> {
    const startedAt = performance.now();
    const body = await this.call("/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: this.model,
        messages: this.messages(request),
        temperature: request.temperature,
        max_completion_tokens: request.maxOutputTokens,
        ...(responseFormat ? { response_format: responseFormat } : {}),
      }),
    }, request.signal);

    const choice = (Array.isArray(body.choices) ? body.choices[0] : undefined) as { message?: { content?: unknown }; finish_reason?: string } | undefined;
    const finishReason = choice?.finish_reason;
    const text = typeof choice?.message?.content === "string" ? choice.message.content.trim() : "";
    if (finishReason === "length") throw new AIError("AI_RESPONSE_TRUNCATED", "The AI response was cut short. Try a smaller or simpler request.", false, undefined, "finishReason=length");
    if (finishReason === "content_filter") throw new AIError("AI_PROVIDER_INVALID_RESPONSE", "Canvas AI could not complete this request. Try rephrasing it.", false, undefined, "finishReason=content_filter");
    if (!text) throw new AIError("AI_RESPONSE_EMPTY", "Canvas AI returned an empty response. Try again.", false, undefined, "empty response");

    const usage = body.usage as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } | undefined;
    return {
      text, provider: this.name, model: this.model,
      providerRequestId: typeof body.id === "string" ? body.id : undefined,
      finishReason,
      timing: { providerLatencyMs: Math.round(performance.now() - startedAt) },
      usage: usage ? { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens, totalTokens: usage.total_tokens, cachedTokens: usage.prompt_tokens_details?.cached_tokens } : undefined,
    };
  }

  // Async so a capability refusal is a rejected promise, exactly like a provider failure.
  async generateText(request: AIRequest) {
    if (request.messages.some((message) => message.parts.some((part) => part.type === "image"))) requireModelCapability(this.capabilities, "vision", this.model);
    return this.complete(request);
  }

  /**
   * Structured output. The JSON Schema is sent to the provider where it is supported, so
   * the constraint is enforced upstream as well; Canvas's Zod contract stays the
   * authority regardless. Compatible endpoints that reject `json_schema` fall back once
   * to plain JSON mode rather than failing the generation.
   */
  async generateStructured<T>(request: AIRequest, validator: StructuredValidator<T>): Promise<AIResponse<T>> {
    requireModelCapability(this.capabilities, "structuredOutput", this.model);
    if (request.messages.some((message) => message.parts.some((part) => part.type === "image"))) requireModelCapability(this.capabilities, "vision", this.model);
    const schema = request.responseSchema;
    let result: AIResponse;
    try {
      result = await this.complete(request, schema ? { type: "json_schema", json_schema: { name: "canvas_response", schema, strict: false } } : { type: "json_object" });
    } catch (error) {
      const rejectedSchema = error instanceof AIError && error.code === "AI_PROVIDER_INVALID_RESPONSE" && /response_format|json_schema/i.test(error.diagnostic ?? "");
      if (!rejectedSchema) throw error;
      result = await this.complete({ ...request, systemInstructions: `${request.systemInstructions}\n\nReturn only one JSON object matching this JSON Schema exactly:\n${JSON.stringify(schema)}` }, { type: "json_object" });
    }
    return { ...result, structuredData: parseStructuredText(result.text, validator, result.finishReason) };
  }
}

/** Pulls the human-readable part out of an OpenAI-style error envelope. */
export function providerMessage(body: string) {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string; code?: string } | string; message?: string };
    if (typeof parsed.error === "string") return parsed.error;
    return parsed.error?.message ?? parsed.message ?? body;
  } catch { return body; }
}
