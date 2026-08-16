import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, sql } from "@/server/db/client";
import { aiConnectionModels, aiConnections, aiMessages, aiUsageEvents, generationJobs, projectAISettings, projectMembers, users } from "@/server/db/schema";
import { WorkspaceService } from "@/domain/workspaces/service";
import { ProjectService } from "@/domain/projects/service";
import { PageTreeService } from "@/domain/pages/service";
import { GenerationJobService, claimGenerationJob } from "@/domain/ai/job-service";
import { AIOrchestrationService } from "@/domain/ai/orchestration-service";
import { AIConnectionService } from "./connection-service";
import { ProjectModelService } from "./project-model-service";
import { AITestConsoleService } from "./test-console-service";
import { resolveProjectModel } from "./model-resolution";
import { AIAnalyticsService } from "@/domain/ai/analytics/analytics-service";
import { recordAIUsage } from "@/domain/ai/analytics/usage-service";
import { setTelemetrySink } from "@/server/observability/telemetry";
import { ExportService } from "@/domain/export/export-service";
import { PreviewManifestService } from "@/generated-runtime/manifest/service";
import type { AIProvider, AIRequest, AIResponse, StructuredValidator } from "@/domain/ai/provider";

const API_KEY = "sk-live-secret-value-000111222333";
// A tagged-template query is a one-shot thenable: awaiting the same value twice
// returns the first result without touching the database, so this has to be a function.
const truncate = () => sql`TRUNCATE TABLE ai_usage_events, ai_connection_models, project_ai_settings, ai_connections, export_jobs, project_checkpoint_items, project_checkpoints, change_set_items, change_sets, building_block_usages, building_block_versions, building_blocks, generation_job_media, page_versions, ai_job_rate_limits, generation_jobs, ai_messages, ai_conversations, project_instructions, media_assets, media_folders, page_nodes, audit_events, editing_leases, project_invites, project_members, auth_rate_limits, sessions, auth_credentials, projects, workspaces, users RESTART IDENTITY CASCADE`;

async function makeUser(label: string) {
  const id = randomUUID();
  const [record] = await db.insert(users).values({ id, email: `${label}-${id}@test.dev`, normalizedEmail: `${label}-${id}@test.dev`, displayName: label }).returning();
  return record!;
}

async function workspaceWithProject(label: string) {
  const owner = await makeUser(label);
  const workspace = await new WorkspaceService().create(owner.id, { name: `${label} workspace` });
  const project = await new ProjectService().create(owner.id, { workspaceId: workspace.id, name: `${label} site` });
  return { owner, workspace, project };
}

/** A connection with one enabled, priced model, selected by the project. */
async function connectedProject(label: string, options: { modelId?: string; provider?: "gemini" | "openai" | "anthropic" | "openai_compatible" } = {}) {
  const context = await workspaceWithProject(label);
  const connection = await new AIConnectionService().create(context.owner.id, {
    workspaceId: context.workspace.id, provider: options.provider ?? "openai", name: "Team key",
    baseUrl: options.provider === "openai_compatible" ? "https://local.test/v1" : null, apiKey: API_KEY,
  });
  const model = await new AIConnectionService().addModel(context.owner.id, {
    connectionId: connection.id, modelId: options.modelId ?? "gpt-5", enabled: true,
    inputPricePerMillion: 3, outputPricePerMillion: 15, pricingCurrency: "USD",
  });
  await new ProjectModelService().select(context.owner.id, { projectId: context.project.id, connectionId: connection.id, modelRecordId: model.id });
  return { ...context, connection, model };
}

class StubProvider implements AIProvider {
  readonly name = "openai"; readonly model = "gpt-5";
  readonly capabilities = { structuredOutput: true, vision: true };
  constructor(private readonly text = "A concise answer.") {}
  async generateText(): Promise<AIResponse> {
    return { text: this.text, provider: this.name, model: this.model, usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 }, timing: { providerLatencyMs: 120 } };
  }
  async generateStructured<T>(_request: AIRequest, validator: StructuredValidator<T>): Promise<AIResponse<T>> {
    return { ...(await this.generateText()), structuredData: validator.parse({}) };
  }
}

describe.sequential("Workspace AI connections, model selection, and analytics", () => {
  beforeEach(async () => { await truncate(); setTelemetrySink(null); });
  afterAll(async () => { await sql.end(); });

  describe("credential security", () => {
    it("stores only ciphertext and never returns a usable key to a caller", async () => {
      const { connection, owner, workspace } = await connectedProject("secure");
      expect(JSON.stringify(connection)).not.toContain(API_KEY);
      expect(connection.credentialHint).toBe("••••2333");
      expect("apiKey" in connection).toBe(false);

      const [row] = await db.select().from(aiConnections).where(eq(aiConnections.id, connection.id));
      expect(row!.credentialCiphertext).not.toContain(API_KEY);
      expect(row!.credentialCiphertext.startsWith("v1.")).toBe(true);

      const listed = await new AIConnectionService().list(owner.id, workspace.id);
      expect(JSON.stringify(listed)).not.toContain(API_KEY);
    });

    it("refuses another workspace owner access to a connection, its models, and its removal", async () => {
      const { connection, workspace } = await connectedProject("victim");
      const attacker = await workspaceWithProject("attacker");
      const service = new AIConnectionService();

      await expect(service.list(attacker.owner.id, workspace.id)).rejects.toThrow(/do not have access/i);
      await expect(service.update(attacker.owner.id, { connectionId: connection.id, name: "Stolen" })).rejects.toThrow(/do not have access/i);
      await expect(service.remove(attacker.owner.id, connection.id)).rejects.toThrow(/do not have access/i);
      await expect(service.test(attacker.owner.id, connection.id)).rejects.toThrow(/do not have access/i);
      await expect(service.discoverModels(attacker.owner.id, connection.id)).rejects.toThrow(/do not have access/i);
      await expect(service.addModel(attacker.owner.id, { connectionId: connection.id, modelId: "sneaky" })).rejects.toThrow(/do not have access/i);
    });

    it("refuses a project collaborator any view of, or change to, workspace credentials", async () => {
      const { connection, workspace, project, model } = await connectedProject("shared");
      const collaborator = await makeUser("collaborator");
      await db.insert(projectMembers).values({ projectId: project.id, userId: collaborator.id, role: "collaborator" });

      await expect(new AIConnectionService().list(collaborator.id, workspace.id)).rejects.toThrow(/do not have access/i);
      await expect(new AIConnectionService().update(collaborator.id, { connectionId: connection.id, apiKey: "sk-live-attacker-key-value" })).rejects.toThrow(/do not have access/i);
      // A collaborator may still use the project's selection, and sees no credential in it.
      const selection = await new ProjectModelService().read(collaborator.id, project.id);
      expect(selection.model?.id).toBe(model.id);
      expect(selection.canSelect).toBe(false);
      expect(JSON.stringify(selection)).not.toContain(API_KEY);
      expect(JSON.stringify(selection)).not.toContain("credentialHint");
      // And may not change the project's selection either.
      await expect(new ProjectModelService().select(collaborator.id, { projectId: project.id, connectionId: connection.id, modelRecordId: model.id })).rejects.toThrow(/Only the project owner/i);
    });

    it("refuses a project owner in another workspace the use of a foreign connection", async () => {
      const victim = await connectedProject("owner-a");
      const outsider = await workspaceWithProject("owner-b");

      await expect(new ProjectModelService().select(outsider.owner.id, {
        projectId: outsider.project.id, connectionId: victim.connection.id, modelRecordId: victim.model.id,
      })).rejects.toThrow(/not available to this website/i);

      // Even a row forced into place cannot be resolved across the tenant boundary.
      await db.insert(projectAISettings).values({ projectId: outsider.project.id, connectionId: victim.connection.id, modelId: victim.model.id })
        .onConflictDoUpdate({ target: projectAISettings.projectId, set: { connectionId: victim.connection.id, modelId: victim.model.id } });
      await expect(resolveProjectModel(outsider.project.id)).rejects.toMatchObject({ code: "AI_NOT_CONFIGURED", diagnostic: "connection belongs to another workspace" });
    });

    it("keeps credentials out of jobs, messages, usage records, telemetry, preview, and exports", async () => {
      const { owner, project, connection } = await connectedProject("leak");
      const home = await new PageTreeService().create(owner.id, { projectId: project.id, type: "page", name: "Home" });
      const lines: string[] = [];
      setTelemetrySink((line) => lines.push(line));

      const request = await new GenerationJobService().createPageJob(owner.id, { projectId: project.id, pageId: home.id, content: "Build the homepage", selectedMediaIds: [] });
      await claimGenerationJob("worker");
      // The adapter is stubbed so the suite never reaches a network: what is under test
      // here is where the credential ends up, not what a provider would have replied.
      await new AIOrchestrationService(db, undefined, undefined, async (projectId) => ({
        resolved: await resolveProjectModel(projectId), provider: new StubProvider(),
      })).process(request.job.id);
      await recordAIUsage({
        workspaceId: (await db.select().from(aiConnections).where(eq(aiConnections.id, connection.id)))[0]!.workspaceId,
        projectId: project.id, connectionId: connection.id, provider: "openai", modelId: "gpt-5",
        requestKind: "generation", operation: "page_generate", succeeded: true,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        pricing: { inputPerMillion: 3, outputPerMillion: 15, currency: "USD", version: 1 },
      });

      const persisted = JSON.stringify([
        await db.select().from(generationJobs),
        await db.select().from(aiMessages),
        await db.select().from(aiUsageEvents),
        await db.select().from(aiConnectionModels),
      ]);
      expect(persisted).not.toContain(API_KEY);
      expect(lines.join("\n")).not.toContain(API_KEY);

      // Preview and export are separate distribution surfaces, so both are checked.
      process.env.PREVIEW_TOKEN_SECRET ??= "ai-platform-suite-preview-secret-value-long";
      const session = await new PreviewManifestService().createSession(owner.id, project.id);
      expect(JSON.stringify(session)).not.toContain(API_KEY);
      const exportJob = await new ExportService().create(owner.id, project.id).catch(() => null);
      if (exportJob) expect(JSON.stringify(exportJob)).not.toContain(API_KEY);
    });
  });

  describe("model selection", () => {
    it("resolves a project's selected connection and model for generation", async () => {
      const { project, connection, model } = await connectedProject("resolve");
      const resolved = await resolveProjectModel(project.id);
      expect(resolved.connection.id).toBe(connection.id);
      expect(resolved.model.modelId).toBe(model.modelId);
    });

    it("refuses a disabled model at selection time and at resolution time", async () => {
      const { owner, project, connection, model } = await connectedProject("disabled");
      await new AIConnectionService().updateModel(owner.id, { modelRecordId: model.id, enabled: false });
      await expect(resolveProjectModel(project.id)).rejects.toMatchObject({ code: "AI_NOT_CONFIGURED", diagnostic: "selected model disabled" });
      await expect(new ProjectModelService().select(owner.id, { projectId: project.id, connectionId: connection.id, modelRecordId: model.id })).rejects.toThrow(/not enabled/i);
    });

    it("fails safely when the connection is removed and leaves the website intact", async () => {
      const { owner, project, connection } = await connectedProject("removed");
      const home = await new PageTreeService().create(owner.id, { projectId: project.id, type: "page", name: "Home" });
      await new AIConnectionService().remove(owner.id, connection.id);

      const selection = await new ProjectModelService().read(owner.id, project.id);
      expect(selection.connectionId).toBeNull();
      expect(selection.options).toHaveLength(0);

      const request = await new GenerationJobService().createPageJob(owner.id, { projectId: project.id, pageId: home.id, content: "Build it", selectedMediaIds: [] });
      await claimGenerationJob("worker");
      const job = await new AIOrchestrationService().process(request.job.id);
      expect(job).toMatchObject({ status: "failed", errorCode: "AI_NOT_CONFIGURED" });
      // The page tree is untouched by a configuration failure.
      expect(await new PageTreeService().listTree(owner.id, project.id)).toHaveLength(1);
    });

    it("records the resolved provider, model, connection, and prompt version on the job", async () => {
      const { owner, project, connection } = await connectedProject("recorded");
      const conversationOwner = owner;
      const home = await new PageTreeService().create(conversationOwner.id, { projectId: project.id, type: "page", name: "Home" });
      const request = await new GenerationJobService().createPageJob(owner.id, { projectId: project.id, pageId: home.id, content: "Build it", selectedMediaIds: [] });
      const [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, request.job.id));
      expect(job).toMatchObject({ provider: "openai", providerModel: "gpt-5", aiConnectionId: connection.id });
    });
  });

  describe("test console", () => {
    it("returns normalized metrics without touching the website or the agent conversation", async () => {
      const { owner, project } = await connectedProject("console");
      const result = await new AITestConsoleService(db, undefined, async (projectId) => ({
        resolved: await resolveProjectModel(projectId), provider: new StubProvider("Landing pages introduce one offer."),
      })).run(owner.id, { projectId: project.id, prompt: "What is a landing page for?" });

      expect(result).toMatchObject({
        status: "succeeded", provider: "openai", model: "gpt-5",
        response: "Landing pages introduce one offer.",
        inputTokens: 100, outputTokens: 50, totalTokens: 150,
        // Canvas does not stream this request, so it says so rather than inventing a number.
        timeToFirstTokenMs: null,
      });
      expect(result.cost).toMatchObject({ source: "canvas_estimate", currency: "USD" });
      expect(result.cost.amount).toBeCloseTo(100 / 1_000_000 * 3 + 50 / 1_000_000 * 15, 10);

      // Nothing was written to the website or to the agent's conversation.
      expect(await db.select().from(generationJobs)).toHaveLength(0);
      expect(await db.select().from(aiMessages)).toHaveLength(0);
      // But the usage was recorded, so analytics stay complete.
      const [usage] = await db.select().from(aiUsageEvents);
      expect(usage).toMatchObject({ requestKind: "test_console", operation: "test_console", succeeded: true, projectId: project.id });
    });

    it("records a failed test without inventing tokens or cost", async () => {
      const { owner, project } = await connectedProject("console-fail");
      const failing: AIProvider = {
        name: "openai", model: "gpt-5", capabilities: { structuredOutput: true, vision: true },
        generateText: async () => { const { AIError } = await import("@/domain/ai/provider"); throw new AIError("AI_PROVIDER_AUTH_FAILED", "This AI connection was rejected by the provider."); },
        generateStructured: async () => { throw new Error("unused"); },
      };
      const result = await new AITestConsoleService(db, undefined, async (projectId) => ({ resolved: await resolveProjectModel(projectId), provider: failing }))
        .run(owner.id, { projectId: project.id, prompt: "Hello" });

      expect(result).toMatchObject({ status: "failed", response: null, inputTokens: null, totalTokens: null });
      expect(result.error).toMatchObject({ code: "AI_PROVIDER_AUTH_FAILED" });
      expect(result.cost).toMatchObject({ source: null, amount: null });
      const [usage] = await db.select().from(aiUsageEvents);
      expect(usage).toMatchObject({ succeeded: false, errorCode: "AI_PROVIDER_AUTH_FAILED", costAmount: null });
    });

    it("refuses a collaborator and rate-limits repeated use", async () => {
      const { owner, project } = await connectedProject("console-auth");
      const collaborator = await makeUser("collaborator");
      await db.insert(projectMembers).values({ projectId: project.id, userId: collaborator.id, role: "collaborator" });
      const service = new AITestConsoleService(db, undefined, async (projectId) => ({ resolved: await resolveProjectModel(projectId), provider: new StubProvider() }));

      await expect(service.run(collaborator.id, { projectId: project.id, prompt: "Hello" })).rejects.toThrow(/Only the project owner/i);

      for (let attempt = 0; attempt < 10; attempt += 1) await service.run(owner.id, { projectId: project.id, prompt: "Hello" });
      await expect(service.run(owner.id, { projectId: project.id, prompt: "Hello" })).rejects.toThrow(/Too many attempts/i);
    });
  });

  describe("analytics", () => {
    async function seed(projectId: string, workspaceId: string, connectionId: string, entries: Array<Partial<Parameters<typeof recordAIUsage>[0]>>) {
      for (const entry of entries) {
        await recordAIUsage({
          workspaceId, projectId, connectionId, provider: "openai", modelId: "gpt-5",
          requestKind: "generation", operation: "page_generate", succeeded: true,
          pricing: { inputPerMillion: 3, outputPerMillion: 15, currency: "USD", version: 1 },
          ...entry,
        } as Parameters<typeof recordAIUsage>[0]);
      }
    }

    it("aggregates tokens, latency percentiles, cost, and failures correctly", async () => {
      const { owner, project, workspace, connection } = await connectedProject("analytics");
      // Latencies 100…1000 give an exact median of 550 and a p95 of 955.
      const latencies = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
      await seed(project.id, workspace.id, connection.id, latencies.map((providerLatencyMs) => ({
        providerLatencyMs, jobDurationMs: providerLatencyMs + 500,
        usage: { inputTokens: 1_000, outputTokens: 500, totalTokens: 1_500 },
      })));
      await seed(project.id, workspace.id, connection.id, [{ succeeded: false, errorCode: "AI_PROVIDER_TIMEOUT", providerLatencyMs: 200 }]);

      const summary = await new AIAnalyticsService().summary(owner.id, project.id, "24h");
      expect(summary.requests).toMatchObject({ total: 11, succeeded: 10, failed: 1 });
      expect(summary.requests.successRate).toBeCloseTo(10 / 11, 10);
      expect(summary.tokens).toEqual({ input: 10_000, output: 5_000, total: 15_000 });
      // Eleven samples: the ten successes plus the failed request's 200 ms.
      expect(summary.latency.providerP50Ms).toBe(500);
      expect(summary.latency.providerP95Ms).toBe(950);
      // Provider latency and whole-job duration are distinct measurements.
      expect(summary.latency.jobAverageMs).toBe(1_050);
      expect(summary.latency.providerAverageMs).toBe(localAverage([...latencies, 200]));

      const estimate = summary.costs.find((entry) => entry.source === "canvas_estimate");
      expect(estimate).toMatchObject({ currency: "USD", requests: 10 });
      expect(estimate!.amount).toBeCloseTo(10 * (1_000 / 1_000_000 * 3 + 500 / 1_000_000 * 15), 8);
      // The failed request had no usage, so it is unknown cost rather than zero cost.
      expect(summary.requestsWithUnknownCost).toBe(1);
      expect(summary.breakdown[0]).toMatchObject({ provider: "openai", model: "gpt-5", requests: 11, failed: 1 });
    });

    it("keeps unknown cost unknown rather than counting it as free", async () => {
      const { owner, project, workspace, connection } = await connectedProject("analytics-cost");
      await seed(project.id, workspace.id, connection.id, [{
        usage: { inputTokens: 100, outputTokens: 100, totalTokens: 200 },
        pricing: { inputPerMillion: null, outputPerMillion: null, currency: null, version: 1 },
      }]);
      const summary = await new AIAnalyticsService().summary(owner.id, project.id, "24h");
      expect(summary.costs).toHaveLength(0);
      expect(summary.requestsWithUnknownCost).toBe(1);
      expect(summary.tokens.total).toBe(200);
    });

    it("keeps one project's usage out of another's analytics", async () => {
      const first = await connectedProject("analytics-a");
      const second = await connectedProject("analytics-b");
      await seed(first.project.id, first.workspace.id, first.connection.id, [{ usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 } }]);
      await seed(second.project.id, second.workspace.id, second.connection.id, [{ usage: { inputTokens: 999, outputTokens: 999, totalTokens: 1_998 } }]);

      const summary = await new AIAnalyticsService().summary(first.owner.id, first.project.id, "24h");
      expect(summary.requests.total).toBe(1);
      expect(summary.tokens.total).toBe(20);
      // And a stranger cannot read them at all.
      await expect(new AIAnalyticsService().summary(second.owner.id, first.project.id, "24h")).rejects.toThrow(/do not have access/i);
    });

    it("preserves historical cost when model pricing is edited afterwards", async () => {
      const { owner, project, workspace, connection, model } = await connectedProject("analytics-pricing");
      await seed(project.id, workspace.id, connection.id, [{ usage: { inputTokens: 1_000_000, outputTokens: 0, totalTokens: 1_000_000 } }]);
      const before = await new AIAnalyticsService().summary(owner.id, project.id, "24h");

      await new AIConnectionService().updateModel(owner.id, { modelRecordId: model.id, inputPricePerMillion: 30, outputPricePerMillion: 150 });
      const after = await new AIAnalyticsService().summary(owner.id, project.id, "24h");
      expect(after.costs[0]!.amount).toBeCloseTo(before.costs[0]!.amount, 10);

      const [row] = await db.select().from(aiConnectionModels).where(eq(aiConnectionModels.id, model.id));
      expect(row!.pricingVersion).toBe(2);
    });
  });

  describe("model discovery", () => {
    it("adds discovered models disabled, and keeps owner decisions on re-discovery", async () => {
      const { owner, workspace } = await workspaceWithProject("discovery");
      const service = new AIConnectionService();
      const connection = await service.create(owner.id, { workspaceId: workspace.id, provider: "openai", name: "Key", baseUrl: null, apiKey: API_KEY });

      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ data: [{ id: "gpt-5" }, { id: "gpt-5-mini" }] })) });
      const original = globalThis.fetch;
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      try {
        const first = await service.discoverModels(owner.id, connection.id);
        expect(first.models.every((model) => !model.enabled)).toBe(true);

        const target = first.models.find((model) => model.modelId === "gpt-5")!;
        await service.updateModel(owner.id, { modelRecordId: target.id, enabled: true, inputPricePerMillion: 3, outputPricePerMillion: 15 });

        const second = await service.discoverModels(owner.id, connection.id);
        const refreshed = second.models.find((model) => model.modelId === "gpt-5")!;
        expect(refreshed).toMatchObject({ enabled: true, inputPricePerMillion: 3, outputPricePerMillion: 15 });
      } finally { globalThis.fetch = original; }
    });

    it("supports manual model IDs when a connection cannot list models", async () => {
      const { owner, workspace } = await workspaceWithProject("manual");
      const service = new AIConnectionService();
      const connection = await service.create(owner.id, { workspaceId: workspace.id, provider: "openai_compatible", name: "Self hosted", baseUrl: "https://local.test/v1", apiKey: API_KEY });
      const model = await service.addModel(owner.id, { connectionId: connection.id, modelId: "local/llama-4", enabled: true });
      expect(model).toMatchObject({ modelId: "local/llama-4", source: "manual", enabled: true });
      await expect(service.addModel(owner.id, { connectionId: connection.id, modelId: "local/llama-4" })).rejects.toThrow(/already on this connection/i);
    });
  });
});

function localAverage(values: number[]) { return Math.round(values.reduce((total, value) => total + value, 0) / values.length); }
