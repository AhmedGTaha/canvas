import { AIError, requireModelCapability, type AIProvider, type AIRequest, type AIResponse, type ModelCapabilities, type ProviderModelDescriptor, type StructuredValidator } from "@/domain/ai/provider";
import { normalizeProviderStatus, normalizeTransportError, parseStructuredText, safeDiagnostic } from "./provider-errors";
import { normalizeBaseUrl } from "./openai-provider";

export const ANTHROPIC_DEFAULT_BASE_URL = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";
const STRUCTURED_TOOL = "canvas_structured_response";

/**
 * Anthropic Messages adapter.
 *
 * Anthropic has no `response_format`, so structured output is a forced tool call whose
 * input schema is the Canvas response schema — the provider-side encoding of the same
 * contract Zod enforces afterwards. Nothing else about Anthropic leaks past this file.
 */
export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";
  readonly capabilities: ModelCapabilities;
  private readonly baseUrl: string;

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly timeoutMs: number,
    options: { baseUrl?: string | null; capabilities?: ModelCapabilities } = {},
  ) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl, ANTHROPIC_DEFAULT_BASE_URL);
    this.capabilities = options.capabilities ?? { structuredOutput: true, vision: true };
  }

  private async call(path: string, init: RequestInit, signal?: AbortSignal) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new DOMException("Provider timeout", "TimeoutError")), this.timeoutMs);
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { "Content-Type": "application/json", "x-api-key": this.apiKey, "anthropic-version": ANTHROPIC_VERSION },
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) throw normalizeProviderStatus(response.status, anthropicMessage(text), this.name, this.apiKey);
      try { return JSON.parse(text) as Record<string, unknown>; }
      catch { throw new AIError("AI_RESPONSE_MALFORMED", "Canvas AI returned an unreadable response. Try again.", false, undefined, safeDiagnostic("anthropic: non-JSON response body")); }
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
    const body = await this.call("/models?limit=100", { method: "GET" });
    const data = Array.isArray(body.data) ? body.data : [];
    const models = data
      .map((entry) => (entry && typeof entry === "object" ? entry as { id?: unknown; display_name?: unknown } : undefined))
      .filter((entry): entry is { id: string; display_name?: string } => typeof entry?.id === "string")
      .map((entry) => ({ modelId: entry.id, displayName: entry.display_name ?? entry.id, capabilities: { structuredOutput: true, vision: true } }));
    if (!models.length) throw new AIError("AI_MODEL_LISTING_UNSUPPORTED", "This connection did not return a usable model list. Add model IDs manually.", false, undefined, "anthropic: empty model list");
    return models;
  }

  private payload(request: AIRequest, tool?: Record<string, unknown>) {
    const context = request.structuredContext === undefined ? "" : `\n\n<canvas_project_context>\n${JSON.stringify(request.structuredContext)}\n</canvas_project_context>`;
    const messages = request.messages.map((message, index) => ({
      role: message.role,
      content: message.parts.map((part) => part.type === "text"
        ? { type: "text", text: index === 0 ? context + part.text : part.text }
        // Media travels inline as bytes, never as a URL Canvas would have to sign.
        : { type: "image", source: { type: "base64", media_type: part.mimeType, data: Buffer.from(part.data).toString("base64") } }),
    }));
    return {
      model: this.model,
      system: request.systemInstructions,
      messages,
      temperature: request.temperature,
      // Anthropic requires an explicit output budget on every request.
      max_tokens: request.maxOutputTokens ?? 8_192,
      ...(tool ? { tools: [tool], tool_choice: { type: "tool", name: STRUCTURED_TOOL } } : {}),
    };
  }

  private finish(body: Record<string, unknown>, text: string, startedAt: number): AIResponse {
    const usage = body.usage as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number } | undefined;
    const inputTokens = usage?.input_tokens;
    const outputTokens = usage?.output_tokens;
    return {
      text, provider: this.name, model: this.model,
      providerRequestId: typeof body.id === "string" ? body.id : undefined,
      finishReason: typeof body.stop_reason === "string" ? body.stop_reason : undefined,
      timing: { providerLatencyMs: Math.round(performance.now() - startedAt) },
      usage: usage ? {
        inputTokens, outputTokens,
        totalTokens: inputTokens === undefined || outputTokens === undefined ? undefined : inputTokens + outputTokens,
        cachedTokens: usage.cache_read_input_tokens,
      } : undefined,
    };
  }

  async generateText(request: AIRequest): Promise<AIResponse> {
    if (request.messages.some((message) => message.parts.some((part) => part.type === "image"))) requireModelCapability(this.capabilities, "vision", this.model);
    const startedAt = performance.now();
    const body = await this.call("/messages", { method: "POST", body: JSON.stringify(this.payload(request)) }, request.signal);
    if (body.stop_reason === "max_tokens") throw new AIError("AI_RESPONSE_TRUNCATED", "The AI response was cut short. Try a smaller or simpler request.", false, undefined, "stopReason=max_tokens");
    const content = Array.isArray(body.content) ? body.content : [];
    const text = content.filter((part) => (part as { type?: string }).type === "text").map((part) => String((part as { text?: string }).text ?? "")).join("\n").trim();
    if (!text) throw new AIError("AI_RESPONSE_EMPTY", "Canvas AI returned an empty response. Try again.", false, undefined, "empty response");
    return this.finish(body, text, startedAt);
  }

  async generateStructured<T>(request: AIRequest, validator: StructuredValidator<T>): Promise<AIResponse<T>> {
    requireModelCapability(this.capabilities, "structuredOutput", this.model);
    if (request.messages.some((message) => message.parts.some((part) => part.type === "image"))) requireModelCapability(this.capabilities, "vision", this.model);
    const startedAt = performance.now();
    const schema = (request.responseSchema && typeof request.responseSchema === "object" ? request.responseSchema : { type: "object" }) as Record<string, unknown>;
    const body = await this.call("/messages", {
      method: "POST",
      body: JSON.stringify(this.payload(request, { name: STRUCTURED_TOOL, description: "Return the Canvas structured result.", input_schema: schema })),
    }, request.signal);
    if (body.stop_reason === "max_tokens") throw new AIError("AI_RESPONSE_TRUNCATED", "The AI response was cut short. Try a smaller or simpler request.", false, undefined, "stopReason=max_tokens");
    const content = Array.isArray(body.content) ? body.content : [];
    const toolUse = content.find((part) => (part as { type?: string; name?: string }).type === "tool_use" && (part as { name?: string }).name === STRUCTURED_TOOL) as { input?: unknown } | undefined;
    // The forced tool call already produces a JSON object; serializing it keeps one
    // parsing and diagnostic path for every provider.
    const text = toolUse ? JSON.stringify(toolUse.input) : content.filter((part) => (part as { type?: string }).type === "text").map((part) => String((part as { text?: string }).text ?? "")).join("\n").trim();
    if (!text) throw new AIError("AI_RESPONSE_EMPTY", "Canvas AI returned an empty response. Try again.", false, undefined, "empty structured response");
    const result = this.finish(body, text, startedAt);
    return { ...result, structuredData: parseStructuredText(result.text, validator, result.finishReason) };
  }
}

/** Pulls the human-readable part out of an Anthropic error envelope. */
export function anthropicMessage(body: string) {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string; type?: string }; message?: string };
    return parsed.error?.message ?? parsed.error?.type ?? parsed.message ?? body;
  } catch { return body; }
}
