import { db, type Database } from "@/server/db/client";
import { ProjectAccessService } from "@/server/permissions/project-access";
import { consumeRateLimit } from "@/server/rate-limit/service";
import { AIError } from "@/domain/ai/provider";
import { CANVAS_PROMPT_VERSIONS } from "@/domain/ai/prompts/versions";
import { costForRequest, pricingFrom } from "@/domain/ai/analytics/pricing";
import { recordAIUsage } from "@/domain/ai/analytics/usage-service";
import { resolveProjectProvider, type ResolvedProjectModel } from "./model-resolution";
import { testPromptSchema } from "./schemas";
import type { AIProvider } from "@/domain/ai/provider";

const TEST_SYSTEM_INSTRUCTIONS = `You are answering a connectivity and quality check from the Canvas AI settings screen.
Answer the message directly and briefly. This is not a website generation request: do not produce source code unless the message explicitly asks for it, and never claim to have changed a website.`;

export const TEST_CONSOLE_MAX_OUTPUT_TOKENS = 512;

export type TestPromptResult = {
  status: "succeeded" | "failed";
  provider: string;
  model: string;
  connectionName: string;
  response: string | null;
  /** Whole provider round trip, measured by Canvas. */
  totalLatencyMs: number;
  /**
   * Time to first token, only when the provider actually reported streaming timing.
   * Canvas sends this request without streaming, so it is null rather than invented.
   */
  timeToFirstTokenMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cost: { source: "provider_reported" | "canvas_estimate" | null; amount: number | null; currency: string | null };
  promptVersion: string;
  timestamp: string;
  error: { code: string; message: string } | null;
};

/**
 * The AI settings test console.
 *
 * It sends one prompt straight to the project's selected provider and model and reports
 * exactly what came back. It creates no page version, no Change Set, no generation job,
 * and no AI conversation message, so a test can never modify a website or pollute the
 * agent's history. The only thing it persists is the usage record the AI analytics are
 * built from — the same normalized shape a real generation writes.
 */
export class AITestConsoleService {
  constructor(
    private readonly database: Database = db,
    private readonly access = new ProjectAccessService(),
    private readonly providerResolver: (projectId: string) => Promise<{ resolved: ResolvedProjectModel; provider: AIProvider }> = (projectId) => resolveProjectProvider(projectId, database),
  ) {}

  async run(userId: string, input: unknown): Promise<TestPromptResult> {
    const parsed = testPromptSchema.parse(input);
    // Only the project owner may spend the workspace's credential from this screen.
    await this.access.requireProjectOwner(userId, parsed.projectId);
    // Two independent budgets: one so a person cannot hammer the button, one so a
    // project cannot be drained by several owners' sessions at once.
    await consumeRateLimit("ai_test_console_user", `${userId}:${parsed.projectId}`, { attempts: 10, windowMinutes: 15 });
    await consumeRateLimit("ai_test_console_project", parsed.projectId, { attempts: 30, windowMinutes: 15 });

    const { provider, resolved } = await this.providerResolver(parsed.projectId);
    const pricing = pricingFrom(resolved.model);
    const startedAt = new Date();
    const started = performance.now();

    const base = {
      provider: resolved.connection.provider,
      model: resolved.model.modelId,
      connectionName: resolved.connection.name,
      promptVersion: CANVAS_PROMPT_VERSIONS.test_console,
      timeToFirstTokenMs: null,
      timestamp: startedAt.toISOString(),
    };

    try {
      const response = await provider.generateText({
        systemInstructions: TEST_SYSTEM_INSTRUCTIONS,
        messages: [{ role: "user", parts: [{ type: "text", text: parsed.prompt }] }],
        temperature: 0.2,
        maxOutputTokens: TEST_CONSOLE_MAX_OUTPUT_TOKENS,
      });
      const totalLatencyMs = response.timing?.providerLatencyMs ?? Math.round(performance.now() - started);
      const cost = costForRequest(response.usage, pricing, response.reportedCost);
      await recordAIUsage({
        workspaceId: resolved.workspaceId, projectId: parsed.projectId, connectionId: resolved.connection.id, actorUserId: userId,
        provider: resolved.connection.provider, modelId: resolved.model.modelId, requestKind: "test_console", operation: "test_console",
        promptVersion: CANVAS_PROMPT_VERSIONS.test_console, succeeded: true, usage: response.usage, reportedCost: response.reportedCost,
        pricing, providerLatencyMs: totalLatencyMs, startedAt,
      }, this.database);
      return {
        ...base, status: "succeeded", response: response.text, totalLatencyMs,
        inputTokens: response.usage?.inputTokens ?? null,
        outputTokens: response.usage?.outputTokens ?? null,
        totalTokens: response.usage?.totalTokens ?? null,
        cost: { source: cost.source, amount: cost.amount, currency: cost.currency },
        error: null,
      };
    } catch (error) {
      const failure = error instanceof AIError ? error : new AIError("AI_INTERNAL_ERROR", "Canvas could not complete this test request.");
      const totalLatencyMs = Math.round(performance.now() - started);
      await recordAIUsage({
        workspaceId: resolved.workspaceId, projectId: parsed.projectId, connectionId: resolved.connection.id, actorUserId: userId,
        provider: resolved.connection.provider, modelId: resolved.model.modelId, requestKind: "test_console", operation: "test_console",
        promptVersion: CANVAS_PROMPT_VERSIONS.test_console, succeeded: false, errorCode: failure.code,
        pricing, providerLatencyMs: totalLatencyMs, startedAt,
      }, this.database);
      return {
        ...base, status: "failed", response: null, totalLatencyMs,
        inputTokens: null, outputTokens: null, totalTokens: null,
        cost: { source: null, amount: null, currency: null },
        error: { code: failure.code, message: failure.message },
      };
    }
  }
}
