import { GoogleGenAI } from "@google/genai";
import { AIError, type AIProvider, type AIRequest, type AIResponse, type StructuredValidator } from "@/domain/ai/provider";

function errorStatus(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  const value = error as { status?: number; code?: number; message?: string };
  return value.status ?? value.code ?? (value.message?.match(/\b(401|403|429|5\d\d)\b/) ? Number(value.message.match(/\b(401|403|429|5\d\d)\b/)?.[1]) : undefined);
}

export function normalizeGeminiError(error: unknown): AIError {
  if (error instanceof AIError) return error;
  if (error instanceof DOMException && error.name === "AbortError") return new AIError("AI_JOB_CANCELLED", "The AI request was cancelled.");
  const status = errorStatus(error);
  if (status === 401 || status === 403) return new AIError("AI_PROVIDER_AUTH_FAILED", "AI provider authentication failed.");
  if (status === 429) return new AIError("AI_PROVIDER_RATE_LIMITED", "The AI provider is busy. Try again shortly.", true);
  if (status && status >= 500) return new AIError("AI_PROVIDER_UNAVAILABLE", "The AI provider is temporarily unavailable.", true);
  if (error instanceof Error && /timeout/i.test(error.message)) return new AIError("AI_PROVIDER_TIMEOUT", "The AI provider took too long to respond.", true);
  return new AIError("AI_PROVIDER_UNAVAILABLE", "The AI provider request failed.", true);
}

export class GeminiProvider implements AIProvider {
  readonly name = "gemini";
  private readonly client: GoogleGenAI;
  constructor(apiKey: string, readonly model: string, private readonly timeoutMs: number) { this.client = new GoogleGenAI({ apiKey }); }

  private async generate(request: AIRequest, structured = false): Promise<AIResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new DOMException("Provider timeout", "TimeoutError")), this.timeoutMs);
    const abort = () => controller.abort(request.signal?.reason);
    request.signal?.addEventListener("abort", abort, { once: true });
    try {
      const context = request.structuredContext === undefined ? "" : `\n\n<canvas_project_context>\n${JSON.stringify(request.structuredContext)}\n</canvas_project_context>`;
      const contents = request.messages.map((message, index) => ({
        role: message.role === "assistant" ? "model" as const : "user" as const,
        parts: message.parts.map((part) => part.type === "text" ? { text: index === 0 ? part.text + context : part.text } : { inlineData: { mimeType: part.mimeType, data: Buffer.from(part.data).toString("base64") } }),
      }));
      const response = await this.client.models.generateContent({ model: this.model, contents, config: {
        systemInstruction: request.systemInstructions,
        temperature: request.temperature,
        maxOutputTokens: request.maxOutputTokens,
        responseMimeType: structured ? "application/json" : undefined,
        responseJsonSchema: structured ? request.responseSchema : undefined,
        abortSignal: controller.signal,
      } });
      const text = response.text?.trim();
      if (!text) throw new AIError("AI_PROVIDER_INVALID_RESPONSE", "The AI provider returned an empty response.");
      return { text, provider: this.name, model: this.model, providerRequestId: response.responseId, finishReason: response.candidates?.[0]?.finishReason,
        usage: response.usageMetadata ? { inputTokens: response.usageMetadata.promptTokenCount, outputTokens: response.usageMetadata.candidatesTokenCount, totalTokens: response.usageMetadata.totalTokenCount, cachedTokens: response.usageMetadata.cachedContentTokenCount } : undefined };
    } catch (error) {
      if (controller.signal.aborted) {
        if (request.signal?.aborted) throw new AIError("AI_JOB_CANCELLED", "The AI request was cancelled.");
        throw new AIError("AI_PROVIDER_TIMEOUT", "The AI provider took too long to respond.", true);
      }
      throw normalizeGeminiError(error);
    } finally { clearTimeout(timeout); request.signal?.removeEventListener("abort", abort); }
  }

  generateText(request: AIRequest) { return this.generate(request); }
  async generateStructured<T>(request: AIRequest, validator: StructuredValidator<T>) {
    const result = await this.generate(request, true);
    try { return { ...result, structuredData: validator.parse(JSON.parse(result.text)) }; }
    catch { throw new AIError("AI_PROVIDER_INVALID_RESPONSE", "The AI provider returned an invalid structured response."); }
  }
}

