import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AIError, type AIProvider, type AIRequest, type AIResponse, type StructuredValidator } from "./provider";
import { generateWithRepair, type ProviderCallRecord } from "./generation-runner";
import { MAX_VALIDATION_REPAIR_ATTEMPTS } from "@/domain/generated-source/correction";

const schema = z.object({ sourceCode: z.string() });

class ScriptedProvider implements AIProvider {
  readonly name = "fixture"; readonly model = "fixture-1";
  readonly capabilities = { structuredOutput: true, vision: true };
  readonly requests: AIRequest[] = [];
  constructor(private readonly sources: string[]) {}
  async generateText(): Promise<AIResponse> { return { text: "", provider: this.name, model: this.model }; }
  async generateStructured<T>(request: AIRequest, validator: StructuredValidator<T>): Promise<AIResponse<T>> {
    this.requests.push(request);
    const value = { sourceCode: this.sources[Math.min(this.requests.length - 1, this.sources.length - 1)]! };
    return { text: JSON.stringify(value), structuredData: validator.parse(value), provider: this.name, model: this.model, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, timing: { providerLatencyMs: 42 } };
  }
}

const request: AIRequest = {
  systemInstructions: "rules",
  messages: [{ role: "user", parts: [{ type: "text", text: "Build it" }] }],
  requestMetadata: { promptVersion: "canvas-page-modify-v2" },
};

function recorder() {
  const records: ProviderCallRecord[] = [];
  return { records, record: vi.fn(async (entry: ProviderCallRecord) => { records.push(entry); return `usage-${records.length}`; }) };
}

describe("bounded validation repair", () => {
  it("records one usage entry for a first-attempt success", async () => {
    const provider = new ScriptedProvider(["valid"]);
    const { record, records } = recorder();
    const run = await generateWithRepair({ provider, request, schema, promptVersion: "canvas-page-modify-v2", record, validate: async (data) => data.sourceCode });

    expect(run.validated).toBe("valid");
    expect(run.repairAttempts).toBe(0);
    expect(run.providerLatencyMs).toBe(42);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ requestKind: "generation", succeeded: true, promptVersion: "canvas-page-modify-v2", usage: { totalTokens: 15 } });
  });

  it("repairs a rejected candidate once and records both calls distinctly", async () => {
    const provider = new ScriptedProvider(["invalid", "valid"]);
    const { record, records } = recorder();
    const run = await generateWithRepair({
      provider, request, schema, promptVersion: "canvas-page-modify-v2", record,
      validate: async (data) => {
        if (data.sourceCode === "invalid") throw new AIError("AI_GENERATED_SOURCE_INVALID", "rejected", false, undefined, "forbidden import: node:fs");
        return data.sourceCode;
      },
    });

    expect(run.validated).toBe("valid");
    expect(run.repairAttempts).toBe(1);
    expect(provider.requests).toHaveLength(2);
    // The repair replays the rejected candidate and names the defect.
    const repairInstruction = provider.requests[1]!.messages.at(-1)!.parts[0] as { text: string };
    expect(repairInstruction.text).toContain("forbidden import: node:fs");
    expect(records.map((entry) => entry.requestKind)).toEqual(["generation", "repair"]);
    expect(records.map((entry) => entry.succeeded)).toEqual([false, true]);
    expect(records[0]!.errorCode).toBe("AI_GENERATED_SOURCE_INVALID");
  });

  it("stops after the repair bound instead of looping", async () => {
    const provider = new ScriptedProvider(["invalid"]);
    const { record, records } = recorder();
    await expect(generateWithRepair({
      provider, request, schema, promptVersion: "canvas-page-modify-v2", record,
      validate: async () => { throw new AIError("AI_GENERATED_SOURCE_INVALID", "rejected", false, undefined, "still invalid"); },
    })).rejects.toMatchObject({ code: "AI_GENERATED_SOURCE_INVALID" });

    // One initial attempt plus the bounded repairs, and not one call more.
    expect(provider.requests).toHaveLength(MAX_VALIDATION_REPAIR_ATTEMPTS + 1);
    expect(records.every((entry) => !entry.succeeded)).toBe(true);
  });

  it("does not repair a failure that is not a source-validation rejection", async () => {
    const provider = new ScriptedProvider(["valid"]);
    const { record } = recorder();
    await expect(generateWithRepair({
      provider, request, schema, promptVersion: "canvas-page-modify-v2", record,
      validate: async () => { throw new AIError("AI_PAGE_STALE", "changed underneath"); },
    })).rejects.toMatchObject({ code: "AI_PAGE_STALE" });
    expect(provider.requests).toHaveLength(1);
  });

  it("records a provider failure with its latency and rethrows it unchanged", async () => {
    const failing: AIProvider = {
      name: "fixture", model: "fixture-1", capabilities: { structuredOutput: true, vision: true },
      generateText: async () => { throw new Error("unused"); },
      generateStructured: async () => { throw new AIError("AI_PROVIDER_RATE_LIMITED", "busy", true); },
    };
    const { record, records } = recorder();
    await expect(generateWithRepair({ provider: failing, request, schema, promptVersion: "canvas-page-modify-v2", record, validate: async (data) => data }))
      .rejects.toMatchObject({ code: "AI_PROVIDER_RATE_LIMITED", retryable: true });
    expect(records[0]).toMatchObject({ succeeded: false, errorCode: "AI_PROVIDER_RATE_LIMITED" });
    expect(records[0]!.providerLatencyMs).toBeGreaterThanOrEqual(0);
  });
});
