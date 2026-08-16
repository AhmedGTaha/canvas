import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AnthropicProvider } from "./anthropic-provider";
import { OpenAIProvider, normalizeBaseUrl } from "./openai-provider";
import { OpenCodeProvider } from "./opencode-provider";
import type { AIRequest } from "@/domain/ai/provider";

/**
 * Adapter coverage for every wire-protocol provider Canvas speaks: OpenAI, an
 * OpenAI-compatible endpoint, and Anthropic. Every case is mocked — the suite never makes
 * a paid call — and each provider is asserted to normalize onto the same Canvas contract.
 */
const fetchMock = vi.fn();
const original = globalThis.fetch;
beforeEach(() => { fetchMock.mockReset(); globalThis.fetch = fetchMock as unknown as typeof fetch; });
afterEach(() => { globalThis.fetch = original; });

const CAPABLE = { structuredOutput: true, vision: true };
const request = (overrides: Partial<AIRequest> = {}): AIRequest => ({
  systemInstructions: "Platform rules first.",
  messages: [{ role: "user", parts: [{ type: "text", text: "Build a homepage" }] }],
  ...overrides,
});
const schema = z.object({ ok: z.literal(true) });

function json(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)) } as Response);
}
const openaiReply = (content: string) => ({ id: "chatcmpl-1", choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 } });
const anthropicReply = (content: unknown[]) => ({ id: "msg_1", stop_reason: "end_turn", content, usage: { input_tokens: 11, output_tokens: 7 } });

describe("OpenAI adapter", () => {
  const provider = () => new OpenAIProvider("sk-test-key", "gpt-5", 5_000, { capabilities: CAPABLE });

  it("sends the credential only as a bearer header and normalizes the result", async () => {
    fetchMock.mockReturnValue(json(openaiReply("Hello")));
    const response = await provider().generateText(request());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test-key");
    expect(init.body).not.toContain("sk-test-key");
    expect(response).toMatchObject({ text: "Hello", provider: "openai", model: "gpt-5", usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 } });
    expect(response.timing?.providerLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it("puts project context ahead of the request and sends media inline as bytes", async () => {
    fetchMock.mockReturnValue(json(openaiReply("Hello")));
    await provider().generateText(request({
      structuredContext: { project: { name: "Acme" } },
      messages: [{ role: "user", parts: [{ type: "text", text: "Use this" }, { type: "image", mimeType: "image/png", data: new Uint8Array([1, 2, 3]) }] }],
    }));
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string) as { messages: Array<{ role: string; content: unknown }> };
    expect(body.messages[0]).toMatchObject({ role: "system" });
    const parts = body.messages[1]!.content as Array<Record<string, unknown>>;
    expect(String((parts[0] as { text: string }).text).indexOf("canvas_project_context")).toBeLessThan(String((parts[0] as { text: string }).text).indexOf("Use this"));
    expect((parts[1] as { image_url: { url: string } }).image_url.url.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("sends the response schema for structured output and validates with Canvas's own contract", async () => {
    fetchMock.mockReturnValue(json(openaiReply(JSON.stringify({ ok: true }))));
    const response = await provider().generateStructured(request({ responseSchema: { type: "object" } }), schema);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string) as { response_format: { type: string } };
    expect(body.response_format.type).toBe("json_schema");
    expect(response.structuredData).toEqual({ ok: true });
  });

  it("falls back to plain JSON mode for a compatible endpoint that rejects json_schema", async () => {
    fetchMock.mockReturnValueOnce(json({ error: { message: "response_format json_schema is not supported" } }, 400));
    fetchMock.mockReturnValueOnce(json(openaiReply(JSON.stringify({ ok: true }))));
    const compatible = new OpenAIProvider("key", "local-model", 5_000, { baseUrl: "https://local.test/v1/", capabilities: CAPABLE, provider: "openai_compatible" });
    const response = await compatible.generateStructured(request({ responseSchema: { type: "object" } }), schema);
    expect(response.structuredData).toEqual({ ok: true });
    expect(response.provider).toBe("openai_compatible");
    const retry = JSON.parse(fetchMock.mock.calls[1]![1].body as string) as { response_format: { type: string } };
    expect(retry.response_format.type).toBe("json_object");
  });

  it("normalizes auth, rate limit, context, unavailable, and malformed responses", async () => {
    const cases: Array<[unknown, number, string, boolean]> = [
      [{ error: { message: "Incorrect API key provided" } }, 401, "AI_PROVIDER_AUTH_FAILED", false],
      [{ error: { message: "Rate limit reached" } }, 429, "AI_PROVIDER_RATE_LIMITED", true],
      [{ error: { message: "model not found" } }, 404, "AI_NOT_CONFIGURED", false],
      [{ error: { message: "maximum context length" } }, 413, "AI_CONTEXT_TOO_LARGE", false],
      [{ error: { message: "server error" } }, 500, "AI_PROVIDER_UNAVAILABLE", true],
    ];
    for (const [body, status, code, retryable] of cases) {
      fetchMock.mockReturnValueOnce(json(body, status));
      await expect(provider().generateText(request())).rejects.toMatchObject({ code, retryable });
    }
    fetchMock.mockReturnValueOnce(json(openaiReply("not json at all")));
    await expect(provider().generateStructured(request(), schema)).rejects.toMatchObject({ code: "AI_RESPONSE_MALFORMED" });
    fetchMock.mockReturnValueOnce(json({ ...openaiReply(""), choices: [{ message: { content: "" }, finish_reason: "length" }] }));
    await expect(provider().generateText(request())).rejects.toMatchObject({ code: "AI_RESPONSE_TRUNCATED" });
  });

  it("never leaks the credential into a normalized failure", async () => {
    fetchMock.mockReturnValue(json({ error: { message: "Incorrect API key provided: sk-test-key" } }, 401));
    const failure = await provider().generateText(request()).catch((error: unknown) => error) as { message: string; diagnostic?: string };
    expect(`${failure.message} ${failure.diagnostic ?? ""}`).not.toContain("sk-test-key");
  });

  it("times out and reports cancellation separately", async () => {
    fetchMock.mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    await expect(new OpenAIProvider("key", "gpt-5", 10, { capabilities: CAPABLE }).generateText(request())).rejects.toMatchObject({ code: "AI_PROVIDER_TIMEOUT", retryable: true });
    const controller = new AbortController();
    const pending = provider().generateText(request({ signal: controller.signal }));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "AI_JOB_CANCELLED" });
  });

  it("lists models and says so plainly when a compatible endpoint returns none", async () => {
    fetchMock.mockReturnValueOnce(json({ data: [{ id: "gpt-5" }, { id: "gpt-5-mini" }] }));
    await expect(provider().listModels()).resolves.toEqual([{ modelId: "gpt-5", displayName: "gpt-5" }, { modelId: "gpt-5-mini", displayName: "gpt-5-mini" }]);
    fetchMock.mockReturnValueOnce(json({ data: [] }));
    await expect(provider().listModels()).rejects.toMatchObject({ code: "AI_MODEL_LISTING_UNSUPPORTED" });
  });

  it("uses the OpenCode endpoint and exposes only its free models", async () => {
    fetchMock.mockReturnValue(json({ data: [{ id: "deepseek-v4-flash-free" }, { id: "big-pickle" }, { id: "glm-5.2" }] }));
    const openCode = new OpenCodeProvider("oc-test-key", "deepseek-v4-flash-free", 5_000, CAPABLE);
    await expect(openCode.listModels()).resolves.toEqual([
      { modelId: "deepseek-v4-flash-free", displayName: "deepseek-v4-flash-free" },
      { modelId: "big-pickle", displayName: "big-pickle" },
    ]);
    expect(fetchMock.mock.calls[0]![0]).toBe("https://opencode.ai/zen/v1/models");
  });

  it("refuses a request that needs a capability the model does not have", async () => {
    const textOnly = new OpenAIProvider("key", "text-only", 5_000, { capabilities: { structuredOutput: false, vision: false } });
    await expect(textOnly.generateStructured(request(), schema)).rejects.toMatchObject({ code: "AI_MODEL_CAPABILITY_UNSUPPORTED" });
    await expect(textOnly.generateText(request({ messages: [{ role: "user", parts: [{ type: "image", mimeType: "image/png", data: new Uint8Array([1]) }] }] }))).rejects.toMatchObject({ code: "AI_MODEL_CAPABILITY_UNSUPPORTED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("tolerates a base URL entered with a trailing slash or endpoint path", () => {
    expect(normalizeBaseUrl("https://local.test/v1/", "https://fallback")).toBe("https://local.test/v1");
    expect(normalizeBaseUrl("https://local.test/v1/chat/completions", "https://fallback")).toBe("https://local.test/v1");
    expect(normalizeBaseUrl(null, "https://fallback")).toBe("https://fallback");
  });
});

describe("Anthropic adapter", () => {
  const provider = () => new AnthropicProvider("sk-ant-test", "claude-opus-5", 5_000, { capabilities: CAPABLE });

  it("authenticates with x-api-key and normalizes usage into Canvas's shape", async () => {
    fetchMock.mockReturnValue(json(anthropicReply([{ type: "text", text: "Hello" }])));
    const response = await provider().generateText(request());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("sk-ant-test");
    expect((init.headers as Record<string, string>)["anthropic-version"]).toBeDefined();
    expect(response).toMatchObject({ provider: "anthropic", text: "Hello", usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 } });
  });

  it("uses a forced tool call for structured output and validates it with Zod", async () => {
    fetchMock.mockReturnValue(json(anthropicReply([{ type: "tool_use", name: "canvas_structured_response", input: { ok: true } }])));
    const response = await provider().generateStructured(request({ responseSchema: { type: "object", properties: {} } }), schema);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string) as { tools: Array<{ name: string; input_schema: unknown }>; tool_choice: { name: string } };
    expect(body.tools[0]!.name).toBe("canvas_structured_response");
    expect(body.tool_choice.name).toBe("canvas_structured_response");
    expect(response.structuredData).toEqual({ ok: true });
  });

  it("rejects a structured response that does not satisfy the Canvas contract", async () => {
    fetchMock.mockReturnValue(json(anthropicReply([{ type: "tool_use", name: "canvas_structured_response", input: { ok: false } }])));
    await expect(provider().generateStructured(request(), schema)).rejects.toMatchObject({ code: "AI_RESPONSE_SCHEMA_INVALID" });
  });

  it("normalizes auth, rate limit, overload, truncation, and empty responses", async () => {
    fetchMock.mockReturnValueOnce(json({ error: { message: "invalid x-api-key" } }, 401));
    await expect(provider().generateText(request())).rejects.toMatchObject({ code: "AI_PROVIDER_AUTH_FAILED", retryable: false });
    fetchMock.mockReturnValueOnce(json({ error: { type: "overloaded_error", message: "Overloaded" } }, 529));
    await expect(provider().generateText(request())).rejects.toMatchObject({ code: "AI_PROVIDER_UNAVAILABLE", retryable: true });
    fetchMock.mockReturnValueOnce(json({ error: { message: "rate_limit_error" } }, 429));
    await expect(provider().generateText(request())).rejects.toMatchObject({ code: "AI_PROVIDER_RATE_LIMITED", retryable: true });
    fetchMock.mockReturnValueOnce(json({ ...anthropicReply([]), stop_reason: "max_tokens" }));
    await expect(provider().generateText(request())).rejects.toMatchObject({ code: "AI_RESPONSE_TRUNCATED" });
    fetchMock.mockReturnValueOnce(json(anthropicReply([])));
    await expect(provider().generateText(request())).rejects.toMatchObject({ code: "AI_RESPONSE_EMPTY" });
  });

  it("sends media inline as base64 rather than as a URL", async () => {
    fetchMock.mockReturnValue(json(anthropicReply([{ type: "text", text: "ok" }])));
    await provider().generateText(request({ messages: [{ role: "user", parts: [{ type: "image", mimeType: "image/png", data: new Uint8Array([1, 2, 3]) }] }] }));
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string) as { messages: Array<{ content: Array<Record<string, unknown>> }> };
    expect(body.messages[0]!.content[0]).toMatchObject({ type: "image", source: { type: "base64", media_type: "image/png" } });
  });

  it("lists models", async () => {
    fetchMock.mockReturnValue(json({ data: [{ id: "claude-opus-5", display_name: "Claude Opus 5" }] }));
    await expect(provider().listModels()).resolves.toEqual([{ modelId: "claude-opus-5", displayName: "Claude Opus 5", capabilities: { structuredOutput: true, vision: true } }]);
  });
});
