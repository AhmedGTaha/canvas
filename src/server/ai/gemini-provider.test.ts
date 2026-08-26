import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError } from "@google/genai";
import { AIError } from "@/domain/ai/provider";

const generateContent = vi.hoisted(() => vi.fn());
const constructed = vi.hoisted(() => [] as Array<{ apiKey?: string }>);
vi.mock("@google/genai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@google/genai")>();
  return {
    ...actual,
    GoogleGenAI: class {
      models = { generateContent };
      constructor(options: { apiKey?: string }) { constructed.push(options); }
    },
  };
});

const { GeminiProvider, normalizeGeminiError } = await import("./gemini-provider");
const { createProvider, providerTimeoutMs } = await import("./provider-registry");
const { generatedPageResponseJsonSchema, generatedPageResponseSchema } = await import("@/domain/page-generation/contract");

const API_KEY = "AIzaSyTESTKEY0000000000000000000000000000";
const request = (overrides: Record<string, unknown> = {}) => ({
  systemInstructions: "Platform rules first.",
  messages: [{ role: "user" as const, parts: [{ type: "text" as const, text: "Build a homepage" }] }],
  ...overrides,
});
function reply(text: string, extra: Record<string, unknown> = {}) {
  return { text, candidates: [{ finishReason: "STOP" }], responseId: "response-1", usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 }, ...extra };
}
const environment = { ...process.env };
beforeEach(() => { generateContent.mockReset(); constructed.length = 0; });
afterEach(() => { process.env = { ...environment }; });

describe("Gemini adapter construction", () => {
  it("uses a sane provider timeout and rejects nonsense values", () => {
    expect(providerTimeoutMs({} as unknown as NodeJS.ProcessEnv)).toBe(120_000);
    expect(providerTimeoutMs({ AI_PROVIDER_TIMEOUT_MS: "-5" } as unknown as NodeJS.ProcessEnv)).toBe(120_000);
    expect(providerTimeoutMs({ AI_PROVIDER_TIMEOUT_MS: "45000" } as unknown as NodeJS.ProcessEnv)).toBe(45_000);
  });

  it("passes the connection credential to the SDK client and nowhere else", () => {
    const provider = createProvider({ provider: "gemini", apiKey: API_KEY, model: "gemini-2.5-flash", baseUrl: null, capabilities: { structuredOutput: true, vision: true }, timeoutMs: 5_000 });
    expect(constructed).toEqual([{ apiKey: API_KEY }]);
    // Nothing enumerable on the adapter exposes the credential.
    expect(JSON.stringify(provider)).not.toContain(API_KEY);
    expect(provider.model).toBe("gemini-2.5-flash");
  });

  it("refuses a request needing a capability the selected model does not have", async () => {
    const textOnly = new GeminiProvider(API_KEY, "gemini-2.5-flash", 5_000, { structuredOutput: false, vision: false });
    await expect(textOnly.generateStructured(request(), generatedPageResponseSchema)).rejects.toMatchObject({ code: "AI_MODEL_CAPABILITY_UNSUPPORTED" });
    await expect(textOnly.generateText(request({ messages: [{ role: "user", parts: [{ type: "image", mimeType: "image/png", data: new Uint8Array([1]) }] }] }))).rejects.toMatchObject({ code: "AI_MODEL_CAPABILITY_UNSUPPORTED" });
    expect(generateContent).not.toHaveBeenCalled();
  });
});

describe("Gemini request shaping", () => {
  const provider = () => new GeminiProvider(API_KEY, "gemini-2.5-flash", 5_000);

  it("sends system instructions, context, and generation settings", async () => {
    generateContent.mockResolvedValue(reply("hello"));
    await provider().generateText(request({ structuredContext: { project: { name: "Acme" } }, temperature: 0.2, maxOutputTokens: 900 }));
    const call = generateContent.mock.calls[0]![0];
    expect(call.model).toBe("gemini-2.5-flash");
    expect(call.config).toMatchObject({ systemInstruction: "Platform rules first.", temperature: 0.2, maxOutputTokens: 900 });
    // Project data travels as data inside the user turn, never as instructions.
    expect(call.contents[0].parts[0].text).toContain("<canvas_project_context>");
    expect(call.contents[0].parts[0].text).toContain("Acme");
    expect(call.config.responseMimeType).toBeUndefined();
  });

  it("requests JSON with the response schema for structured calls", async () => {
    generateContent.mockResolvedValue(reply(JSON.stringify({ answer: "ok" })));
    const schema = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] };
    await provider().generateStructured(request({ responseSchema: schema }), z.object({ answer: z.string() }));
    const call = generateContent.mock.calls[0]![0];
    expect(call.config.responseMimeType).toBe("application/json");
    expect(call.config.responseJsonSchema).toEqual(schema);
    expect(call.config.responseSchema).toBeUndefined();
  });

  it("sends Canvas Media inline as bytes, never as a URL or storage key", async () => {
    generateContent.mockResolvedValue(reply("ok"));
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    await provider().generateText(request({ messages: [{ role: "user", parts: [{ type: "text", text: "Use this logo" }, { type: "image", mimeType: "image/png", data: bytes }] }] }));
    const parts = generateContent.mock.calls[0]![0].contents[0].parts;
    expect(parts[1]).toEqual({ inlineData: { mimeType: "image/png", data: Buffer.from(bytes).toString("base64") } });
    const serialized = JSON.stringify(generateContent.mock.calls[0]![0]);
    expect(serialized).not.toContain("/api/preview/media");
    expect(serialized).not.toContain("projects/");
    expect(serialized).not.toContain(API_KEY);
  });

  it("puts project context ahead of the request so the instruction is read last", async () => {
    generateContent.mockResolvedValue(reply("ok"));
    await provider().generateText(request({ structuredContext: { project: { name: "Acme" } }, messages: [{ role: "user", parts: [{ type: "text", text: "Build a pricing page" }] }] }));
    const text = generateContent.mock.calls[0]![0].contents[0].parts[0].text as string;
    expect(text.indexOf("</canvas_project_context>")).toBeLessThan(text.indexOf("Build a pricing page"));
    expect(text.trimEnd().endsWith("Build a pricing page")).toBe(true);
  });

  it("sends an explicit thinking budget only when the request asks for one", async () => {
    generateContent.mockResolvedValue(reply("ok"));
    await provider().generateText(request({ reasoningBudget: 6_144 }));
    expect(generateContent.mock.calls[0]![0].config.thinkingConfig).toEqual({ thinkingBudget: 6_144 });

    generateContent.mockReset();
    generateContent.mockResolvedValue(reply("ok"));
    await provider().generateText(request({}));
    expect(generateContent.mock.calls[0]![0].config.thinkingConfig).toBeUndefined();
  });

  it("maps assistant history to the model role", async () => {
    generateContent.mockResolvedValue(reply("ok"));
    await provider().generateText(request({ messages: [
      { role: "user", parts: [{ type: "text", text: "first" }] },
      { role: "assistant", parts: [{ type: "text", text: "previous answer" }] },
      { role: "user", parts: [{ type: "text", text: "now change it" }] },
    ] }));
    expect(generateContent.mock.calls[0]![0].contents.map((entry: { role: string }) => entry.role)).toEqual(["user", "model", "user"]);
  });
});

describe("Gemini structured responses", () => {
  const provider = () => new GeminiProvider(API_KEY, "gemini-2.5-flash", 5_000);
  const validator = z.object({ schemaVersion: z.literal(1), html: z.string() }).strict();

  it("parses structured output and reports usage and request identity", async () => {
    generateContent.mockResolvedValue(reply(JSON.stringify({ schemaVersion: 1, html: `<main data-canvas-id="page"><h1>Page</h1></main>` })));
    await expect(provider().generateStructured(request(), validator)).resolves.toMatchObject({
      structuredData: { schemaVersion: 1 }, provider: "gemini", model: "gemini-2.5-flash",
      providerRequestId: "response-1", usage: { totalTokens: 15 },
    });
  });

  it("keeps Gemini's JSON schema aligned with the canonical page contract", async () => {
    const valid = { schemaVersion: 1, html: `<main data-canvas-id="page"><h1>Page</h1></main>`, referencedMediaIds: [], summary: { headline: "Built", changes: [], limitations: [] } };
    generateContent.mockResolvedValue(reply(JSON.stringify(valid)));
    await expect(provider().generateStructured(request({ responseSchema: generatedPageResponseJsonSchema }), generatedPageResponseSchema)).resolves.toMatchObject({ structuredData: valid });
    const schema = generateContent.mock.calls[0]![0].config.responseJsonSchema;
    expect(schema.properties.referencedMediaIds.items.format).toBe("uuid");
    expect(schema.properties.blockUsages.items.properties.blockId.format).toBe("uuid");
  });

  it("falls back to JSON mode when Gemini rejects a response schema", async () => {
    generateContent
      .mockRejectedValueOnce(new ApiError({ message: "Request contains an invalid argument.", status: 400 }))
      .mockResolvedValueOnce(reply(JSON.stringify({ schemaVersion: 1, html: "<main>Built</main>" })));

    await expect(provider().generateStructured(request({ responseSchema: generatedPageResponseJsonSchema }), validator))
      .resolves.toMatchObject({ structuredData: { schemaVersion: 1, html: "<main>Built</main>" } });

    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(generateContent.mock.calls[0]![0].config.responseJsonSchema).toBe(generatedPageResponseJsonSchema);
    expect(generateContent.mock.calls[1]![0].config).toMatchObject({ responseMimeType: "application/json" });
    expect(generateContent.mock.calls[1]![0].config.responseJsonSchema).toBeUndefined();
    expect(generateContent.mock.calls[1]![0].config.systemInstruction).toContain("Structured response compatibility contract");
    expect(generateContent.mock.calls[1]![0].config.systemInstruction).toContain('"schemaVersion"');
  });

  it("recovers from a stray markdown fence around the JSON", async () => {
    generateContent.mockResolvedValue(reply("```json\n{\"schemaVersion\":1,\"html\":\"x\"}\n```"));
    await expect(provider().generateStructured(request(), validator)).resolves.toMatchObject({ structuredData: { html: "x" } });
  });

  it("rejects unparseable and contract-violating responses without weakening the contract", async () => {
    generateContent.mockResolvedValue(reply("not json at all"));
    await expect(provider().generateStructured(request(), validator)).rejects.toMatchObject({ code: "AI_RESPONSE_MALFORMED", retryable: false, diagnostic: expect.stringContaining("stage=response_parse") });

    generateContent.mockResolvedValue(reply(JSON.stringify({ schemaVersion: 2, sourceCode: "x" })));
    const rejected = await provider().generateStructured(request(), validator).catch((error: AIError) => error);
    expect(rejected).toMatchObject({ code: "AI_RESPONSE_SCHEMA_INVALID" });
    expect((rejected as AIError).diagnostic).toContain("stage=response_schema");
    expect((rejected as AIError).diagnostic).toContain("schemaIssues=schemaVersion:invalid_value");
    // The user-facing message stays plain; provider detail is diagnostic only.
    expect((rejected as AIError).message).not.toContain("schemaVersion");

    generateContent.mockResolvedValue(reply(JSON.stringify({ schemaVersion: 1, sourceCode: "x" })));
    const missing = await provider().generateStructured(request({ responseSchema: generatedPageResponseJsonSchema }), generatedPageResponseSchema).catch((error: AIError) => error);
    expect(missing).toMatchObject({ code: "AI_RESPONSE_SCHEMA_INVALID", diagnostic: expect.stringContaining("stage=response_schema") });

    generateContent.mockResolvedValue(reply(JSON.stringify({ schemaVersion: 1, sourceCode: "x", referencedMediaIds: Array.from({ length: 21 }, () => "11111111-1111-4111-8111-111111111111"), summary: { headline: "Built", changes: [], limitations: [] } })));
    const tooManyReferences = await provider().generateStructured(request({ responseSchema: generatedPageResponseJsonSchema }), generatedPageResponseSchema).catch((error: AIError) => error);
    expect(tooManyReferences).toMatchObject({ code: "AI_RESPONSE_SCHEMA_INVALID", diagnostic: expect.stringContaining("referencedMediaIds:too_big") });
  });

  it("fails clearly when the response was truncated or blocked", async () => {
    generateContent.mockResolvedValue(reply("{\"schemaVersion\":1", { candidates: [{ finishReason: "MAX_TOKENS" }] }));
    await expect(provider().generateStructured(request(), validator)).rejects.toMatchObject({ code: "AI_RESPONSE_TRUNCATED", message: expect.stringContaining("cut short") });

    generateContent.mockResolvedValue(reply("", { candidates: [{ finishReason: "SAFETY" }] }));
    await expect(provider().generateText(request())).rejects.toMatchObject({ code: "AI_PROVIDER_INVALID_RESPONSE", diagnostic: "finishReason=SAFETY" });

    generateContent.mockResolvedValue({ text: "", promptFeedback: { blockReason: "SAFETY" }, candidates: [] });
    await expect(provider().generateText(request())).rejects.toMatchObject({ code: "AI_PROVIDER_INVALID_RESPONSE", diagnostic: "blockReason=SAFETY" });

    generateContent.mockResolvedValue({ text: "", candidates: [{ finishReason: "STOP" }] });
    await expect(provider().generateText(request())).rejects.toMatchObject({ code: "AI_RESPONSE_EMPTY", diagnostic: "empty response" });
  });

  it("surfaces cancellation and timeout distinctly", async () => {
    generateContent.mockImplementation(({ config }: { config: { abortSignal: AbortSignal } }) =>
      new Promise((_resolve, reject) => config.abortSignal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))));
    const controller = new AbortController();
    const pending = new GeminiProvider(API_KEY, "gemini-2.5-flash", 5_000).generateText(request({ signal: controller.signal }));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "AI_JOB_CANCELLED" });

    await expect(new GeminiProvider(API_KEY, "gemini-2.5-flash", 10).generateText(request())).rejects.toMatchObject({ code: "AI_PROVIDER_TIMEOUT", retryable: true });
  });
});

describe("Gemini error normalization", () => {
  it("classifies provider failures into retryable and non-retryable Canvas errors", () => {
    const cases: Array<[unknown, string, boolean]> = [
      [new ApiError({ message: "API key not valid", status: 400 }), "AI_PROVIDER_AUTH_FAILED", false],
      [new ApiError({ message: "unauthenticated", status: 401 }), "AI_PROVIDER_AUTH_FAILED", false],
      [new ApiError({ message: "permission denied", status: 403 }), "AI_PROVIDER_AUTH_FAILED", false],
      [new ApiError({ message: "models/gemini-9 is not found", status: 404 }), "AI_NOT_CONFIGURED", false],
      [new ApiError({ message: "RESOURCE_EXHAUSTED", status: 429 }), "AI_PROVIDER_RATE_LIMITED", true],
      [new ApiError({ message: "request entity too large", status: 413 }), "AI_CONTEXT_TOO_LARGE", false],
      [new ApiError({ message: "deadline exceeded", status: 504 }), "AI_PROVIDER_TIMEOUT", true],
      [new ApiError({ message: "internal", status: 500 }), "AI_PROVIDER_UNAVAILABLE", true],
      [new ApiError({ message: "service unavailable", status: 503 }), "AI_PROVIDER_UNAVAILABLE", true],
      [new ApiError({ message: "INVALID_ARGUMENT: bad schema", status: 400 }), "AI_PROVIDER_INVALID_RESPONSE", false],
      [new Error("request timeout"), "AI_PROVIDER_TIMEOUT", true],
      [new Error("token count exceeds the maximum"), "AI_CONTEXT_TOO_LARGE", false],
      [new DOMException("cancel", "AbortError"), "AI_JOB_CANCELLED", false],
      [{ status: 429 }, "AI_PROVIDER_RATE_LIMITED", true],
      [new Error("socket hang up"), "AI_PROVIDER_UNAVAILABLE", true],
    ];
    for (const [error, code, retryable] of cases) {
      expect(normalizeGeminiError(error), `${code} for ${String((error as Error).message ?? error)}`).toMatchObject({ code, retryable });
    }
  });

  it("honours a provider retry delay and preserves normalized Canvas errors", () => {
    expect(normalizeGeminiError(new ApiError({ message: 'quota exceeded, "retryDelay":"27s"', status: 429 }))).toMatchObject({ retryAfterMs: 27_000 });
    const existing = new AIError("AI_PAGE_STALE", "This page changed.");
    expect(normalizeGeminiError(existing)).toBe(existing);
  });

  it("never puts credentials into user messages or diagnostics", () => {
    const leaky = new ApiError({ message: `request failed for https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`, status: 500 });
    const normalized = normalizeGeminiError(leaky);
    expect(normalized.message).not.toContain(API_KEY);
    expect(normalized.diagnostic).not.toContain(API_KEY);
    expect(normalized.diagnostic).toContain("key=[redacted]");
  });
});
