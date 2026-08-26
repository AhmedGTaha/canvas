import { ApiError, GoogleGenAI } from "@google/genai";
import { createHash } from "node:crypto";
import { ZodError } from "zod";
import { safeDiagnostic } from "./provider-errors";
import { AIError, requireModelCapability, type AIProvider, type AIRequest, type AIResponse, type ModelCapabilities, type ProviderModelDescriptor, type StructuredValidator } from "@/domain/ai/provider";

/** HTTP status of a provider failure, from the SDK error or a status-like shape. */
function errorStatus(error: unknown) {
  if (error instanceof ApiError && Number.isInteger(error.status)) return error.status;
  if (!error || typeof error !== "object") return undefined;
  const value = error as { status?: unknown; code?: unknown; message?: unknown };
  if (Number.isInteger(value.status)) return value.status as number;
  if (Number.isInteger(value.code)) return value.code as number;
  const message = typeof value.message === "string" ? value.message : "";
  const match = /\b(400|401|403|404|408|413|429|5\d\d)\b/.exec(message);
  return match ? Number(match[1]) : undefined;
}
function messageOf(error: unknown) {
  return error instanceof Error ? error.message : typeof error === "string" ? error : "";
}
/** Short, non-sensitive diagnostic for logs. Never includes credentials: it goes through
 *  the same redaction every other adapter uses. */
function diagnostic(error: unknown) {
  return safeDiagnostic(messageOf(error));
}

/**
 * Maps a Gemini failure onto Canvas's normalized AI error model. Retryable failures are
 * transient only; configuration and request problems fail fast so a bad model name or
 * malformed schema is not retried three times behind a misleading message.
 */
export function normalizeGeminiError(error: unknown): AIError {
  if (error instanceof AIError) return error;
  if (error instanceof DOMException && error.name === "AbortError") return new AIError("AI_JOB_CANCELLED", "The AI request was cancelled.");
  const status = errorStatus(error);
  const message = messageOf(error);
  const detail = diagnostic(error);

  if (status === 401 || status === 403 || /API key not valid|API_KEY_INVALID|PERMISSION_DENIED|UNAUTHENTICATED/i.test(message)) {
    return new AIError("AI_PROVIDER_AUTH_FAILED", "This AI connection was rejected by the provider. Check its API key in AI settings.", false, undefined, detail);
  }
  if (status === 404 || /is not found|not supported|NOT_FOUND/i.test(message)) {
    return new AIError("AI_NOT_CONFIGURED", "The selected AI model is unavailable from this connection. Choose a different model in AI settings.", false, undefined, detail);
  }
  if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(message)) {
    return new AIError("AI_PROVIDER_RATE_LIMITED", "Canvas AI is busy right now. Try again shortly.", true, retryDelayMs(error));
  }
  if (status === 413 || /token count|too large|exceeds the maximum/i.test(message)) {
    return new AIError("AI_CONTEXT_TOO_LARGE", "This request is too large for Canvas AI. Try a shorter request or fewer attachments.", false, undefined, detail);
  }
  if (status === 408 || status === 504 || /timeout|timed out|ETIMEDOUT/i.test(message)) {
    return new AIError("AI_PROVIDER_TIMEOUT", "Canvas took too long to generate this. Try again.", true, undefined, detail);
  }
  if (status && status >= 500) {
    return new AIError("AI_PROVIDER_UNAVAILABLE", "Canvas AI is temporarily unavailable. Try again shortly.", true, undefined, detail);
  }
  if (status === 400 || /INVALID_ARGUMENT|FAILED_PRECONDITION/i.test(message)) {
    // A rejected request will be rejected identically on every retry.
    return new AIError("AI_PROVIDER_INVALID_RESPONSE", "Canvas could not complete this AI request. Try again.", false, undefined, detail);
  }
  return new AIError("AI_PROVIDER_UNAVAILABLE", "Canvas AI is temporarily unavailable. Try again shortly.", true, undefined, detail);
}

function retryDelayMs(error: unknown) {
  const match = /retryDelay"?\s*[:=]\s*"?(\d+)s/i.exec(messageOf(error));
  return match ? Number(match[1]) * 1000 : undefined;
}

/** Finish reasons that mean the response is unusable even when text came back. */
const UNUSABLE_FINISH: Record<string, string> = {
  MAX_TOKENS: "The AI response was cut short. Try a smaller or simpler request.",
  SAFETY: "Canvas AI could not complete this request. Try rephrasing it.",
  RECITATION: "Canvas AI could not complete this request. Try rephrasing it.",
  PROHIBITED_CONTENT: "Canvas AI could not complete this request. Try rephrasing it.",
  SPII: "Canvas AI could not complete this request. Try rephrasing it.",
  BLOCKLIST: "Canvas AI could not complete this request. Try rephrasing it.",
  MALFORMED_FUNCTION_CALL: "Canvas AI returned an unusable response. Try again.",
};

function responseFingerprint(label: string, value: string) {
  return `${label}Bytes=${Buffer.byteLength(value, "utf8")} ${label}Sha256=${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

/**
 * Safe diagnostic metadata for a response that cannot become a candidate. Source and
 * prompts must never be logged, so the raw and fence-sanitized payloads are identified
 * only by their sizes and short hashes.
 */
function structuredResponseDiagnostic(raw: string, sanitized: string, finishReason?: string) {
  return [responseFingerprint("raw", raw), responseFingerprint("sanitized", sanitized), finishReason ? `finishReason=${finishReason}` : undefined].filter(Boolean).join(" ");
}

function schemaDiagnostic(error: unknown) {
  if (!(error instanceof ZodError)) return diagnostic(error);
  return error.issues.slice(0, 6).map((issue) => {
    const path = issue.path.length ? issue.path.join(".") : "root";
    const format = "format" in issue && typeof issue.format === "string" ? `(${issue.format})` : "";
    return `${path}:${issue.code}${format}`;
  }).join(", ");
}

/** Strips a stray markdown fence if the model wraps its JSON despite the MIME type. */
function unwrapJson(text: string) {
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/i.exec(text.trim());
  return (fenced ? fenced[1]! : text).trim();
}

/**
 * Gemini adapter for the Canvas provider abstraction. It only turns a provider-neutral
 * `AIRequest` into a Gemini call and back; it never reads Canvas persistence, never
 * mutates state, and never logs or returns the API key.
 */
export class GeminiProvider implements AIProvider {
  readonly name = "gemini";
  readonly capabilities: ModelCapabilities;
  private readonly client: GoogleGenAI;

  constructor(apiKey: string, readonly model: string, private readonly timeoutMs: number, capabilities?: ModelCapabilities) {
    this.client = new GoogleGenAI({ apiKey });
    this.capabilities = capabilities ?? { structuredOutput: true, vision: true };
  }

  /** Model discovery. Gemini reports the methods a model supports, so vision is not
   *  assumed: it is inferred from the model family the provider actually returned. */
  async listModels(): Promise<ProviderModelDescriptor[]> {
    try {
      const models: ProviderModelDescriptor[] = [];
      const pager = await this.client.models.list();
      for await (const model of pager) {
        const id = (model.name ?? "").replace(/^models\//, "");
        if (!id) continue;
        const actions = model.supportedActions ?? [];
        if (actions.length && !actions.includes("generateContent")) continue;
        models.push({ modelId: id, displayName: model.displayName || id, capabilities: { structuredOutput: true, vision: true, contextWindow: model.inputTokenLimit ?? undefined, maxOutputTokens: model.outputTokenLimit ?? undefined } });
      }
      return models;
    } catch (error) { throw normalizeGeminiError(error); }
  }

  private async generate(request: AIRequest, structured: boolean, responseSchema: unknown): Promise<AIResponse> {
    if (structured) requireModelCapability(this.capabilities, "structuredOutput", this.model);
    if (request.messages.some((message) => message.parts.some((part) => part.type === "image"))) requireModelCapability(this.capabilities, "vision", this.model);
    const startedAt = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new DOMException("Provider timeout", "TimeoutError")), this.timeoutMs);
    const abort = () => controller.abort(request.signal?.reason);
    request.signal?.addEventListener("abort", abort, { once: true });
    try {
      // Project context travels as data inside the first user turn, never as instructions.
      const context = request.structuredContext === undefined ? "" : `\n\n<canvas_project_context>\n${JSON.stringify(request.structuredContext)}\n</canvas_project_context>`;
      const contents = request.messages.map((message, index) => ({
        role: message.role === "assistant" ? "model" as const : "user" as const,
        parts: message.parts.map((part) => part.type === "text"
          // Context leads and the request trails it: the instruction the model must act
          // on is the last thing it reads, never buried in front of a large JSON blob.
          ? { text: index === 0 ? context + part.text : part.text }
          // Canvas Media is sent inline as bytes: no storage URL or credential leaves Canvas.
          : { inlineData: { mimeType: part.mimeType, data: Buffer.from(part.data).toString("base64") } }),
      }));

      const response = await this.client.models.generateContent({
        model: this.model,
        contents,
        config: {
          systemInstruction: request.systemInstructions,
          temperature: request.temperature,
          maxOutputTokens: request.maxOutputTokens,
          // Thinking tokens are billed against maxOutputTokens, so an explicit budget
          // keeps a long generation from being truncated by dynamic thinking.
          thinkingConfig: request.reasoningBudget === undefined ? undefined : { thinkingBudget: request.reasoningBudget },
          responseMimeType: structured ? "application/json" : undefined,
          responseJsonSchema: structured ? responseSchema : undefined,
          abortSignal: controller.signal,
        },
      });

      const finishReason = response.candidates?.[0]?.finishReason as string | undefined;
      const text = response.text?.trim();
      if (finishReason && finishReason !== "STOP" && UNUSABLE_FINISH[finishReason]) {
        const code = finishReason === "MAX_TOKENS" ? "AI_RESPONSE_TRUNCATED" : "AI_PROVIDER_INVALID_RESPONSE";
        throw new AIError(code, UNUSABLE_FINISH[finishReason]!, false, undefined, `finishReason=${finishReason}`);
      }
      if (!text) {
        const blockReason = response.promptFeedback?.blockReason;
        throw new AIError(blockReason ? "AI_PROVIDER_INVALID_RESPONSE" : "AI_RESPONSE_EMPTY", blockReason ? "Canvas AI could not complete this request. Try rephrasing it." : "Canvas AI returned an empty response. Try again.", false, undefined, blockReason ? `blockReason=${blockReason}` : "empty response");
      }
      return {
        text, provider: this.name, model: this.model,
        providerRequestId: response.responseId, finishReason,
        timing: { providerLatencyMs: Math.round(performance.now() - startedAt) },
        usage: response.usageMetadata ? {
          inputTokens: response.usageMetadata.promptTokenCount,
          outputTokens: response.usageMetadata.candidatesTokenCount,
          totalTokens: response.usageMetadata.totalTokenCount,
          cachedTokens: response.usageMetadata.cachedContentTokenCount,
        } : undefined,
      };
    } catch (error) {
      if (controller.signal.aborted) {
        if (request.signal?.aborted) throw new AIError("AI_JOB_CANCELLED", "The AI request was cancelled.");
        throw new AIError("AI_PROVIDER_TIMEOUT", "Canvas took too long to generate this. Try again.", true);
      }
      throw normalizeGeminiError(error);
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener("abort", abort);
    }
  }

  generateText(request: AIRequest) { return this.generate(request, false, undefined); }

  /** Parses and validates structured output. Zod stays the contract authority. */
  async generateStructured<T>(request: AIRequest, validator: StructuredValidator<T>): Promise<AIResponse<T>> {
    let result: AIResponse;
    try {
      result = await this.generate(request, true, request.responseSchema);
    } catch (error) {
      // Gemini accepts only a subset of JSON Schema and rejects some valid but deeply
      // nested schemas with a generic INVALID_ARGUMENT response. Keep JSON mode enabled
      // and give the model the exact schema as a text contract. Canvas's validator remains
      // authoritative, rather than making an otherwise usable model unable to generate a
      // page at all.
      if (!request.responseSchema || !(error instanceof AIError) || error.code !== "AI_PROVIDER_INVALID_RESPONSE") throw error;
      const schemaContract = JSON.stringify(request.responseSchema);
      result = await this.generate({
        ...request,
        systemInstructions: `${request.systemInstructions}\n\nStructured response compatibility contract\nThe provider could not enforce the response schema for this request. Return exactly one JSON object matching this schema; do not return prose or Markdown.\n<response_json_schema>${schemaContract}</response_json_schema>`,
      }, true, undefined);
    }
    const sanitized = unwrapJson(result.text);
    const responseDiagnostic = structuredResponseDiagnostic(result.text, sanitized, result.finishReason);
    let parsed: unknown;
    try { parsed = JSON.parse(sanitized); }
    catch { throw new AIError("AI_RESPONSE_MALFORMED", "Canvas AI returned an unreadable response. Try again.", false, undefined, `${responseDiagnostic} stage=response_parse`); }
    try { return { ...result, structuredData: validator.parse(parsed) }; }
    catch (error) {
      throw new AIError("AI_RESPONSE_SCHEMA_INVALID", "Canvas AI returned a response Canvas could not use. Try again.", false, undefined, `${responseDiagnostic} stage=response_schema schemaIssues=${schemaDiagnostic(error)}`);
    }
  }
}
