import { and, eq } from "drizzle-orm";
import { db, type Database } from "@/server/db/client";
import { aiMessages, generationJobs } from "@/server/db/schema";
import { getAIProvider } from "@/server/ai/provider-registry";
import { AIError, type AIProvider } from "./provider";
import { ProjectContextBuilder, type ProjectContextTarget } from "./context";
import { assembleProviderRequest } from "./prompt-assembler";
import { GenerationJobLifecycle, safeAIError } from "./job-service";
import { PageGenerationOrchestrationService } from "@/domain/page-generation/orchestration";
import { BlockGenerationOrchestrationService } from "@/domain/block-generation/orchestration";
import { observe } from "@/server/observability/events";
import { persistedGenerationDiagnostic } from "@/domain/generated-source/diagnostics";

const MAX_ATTEMPTS = 3;

export class AIOrchestrationService {
  constructor(private readonly database: Database = db, private readonly contextBuilder = new ProjectContextBuilder(), private readonly lifecycle = new GenerationJobLifecycle(database), private readonly providerResolver: () => AIProvider = getAIProvider) {}

  private async current(jobId: string) { const [job] = await this.database.select().from(generationJobs).where(eq(generationJobs.id, jobId)).limit(1); return job; }
  private async cancelIfRequested(jobId: string) {
    const job = await this.current(jobId);
    if (!job) return true;
    if (job.cancelRequestedAt && job.status !== "cancelled") { await this.lifecycle.transition(jobId, "cancelled", "Cancelled", { errorCode: "AI_JOB_CANCELLED", errorMessage: "The AI request was cancelled." }); observe.generationJob("cancelled", { jobId, projectId: job.projectId }); return true; }
    return job.status === "cancelled";
  }

  async process(jobId: string) {
    const startedAt = performance.now();
    const job = await this.current(jobId);
    if (!job || ["completed", "failed", "cancelled"].includes(job.status)) return job ?? null;
    if (job.operation === "page_generate" || job.operation === "page_modify") return new PageGenerationOrchestrationService(this.database, this.contextBuilder, this.lifecycle, this.providerResolver).process(jobId);
    if (job.operation === "block_generate" || job.operation === "block_modify") return new BlockGenerationOrchestrationService(this.database, this.contextBuilder, this.lifecycle, this.providerResolver).process(jobId);
    if (await this.cancelIfRequested(jobId)) return this.current(jobId);
    try {
      const [prompt] = job.promptMessageId ? await this.database.select().from(aiMessages).where(eq(aiMessages.id, job.promptMessageId)).limit(1) : [];
      if (!prompt || !job.conversationId) throw new AIError("AI_INTERNAL_ERROR", "The AI job is missing its request message.");
      const metadata = (job.contextMetadata && typeof job.contextMetadata === "object" ? job.contextMetadata : {}) as { selectedMediaIds?: string[] };
      const target: ProjectContextTarget = job.targetType === "page" && job.targetId ? { type: "page", id: job.targetId } : { type: "project" };
      const context = await this.contextBuilder.build({ projectId: job.projectId, actorUserId: job.actorUserId, target, selectedMediaIds: metadata.selectedMediaIds, conversationId: job.conversationId, operation: "project_assistant" });
      await this.database.update(generationJobs).set({ contextFingerprint: context.fingerprint, contextMetadata: { ...metadata, ...context.composition } }).where(eq(generationJobs.id, jobId));
      observe.generationJob("started", { jobId, projectId: job.projectId, operation: "assistant" });
      if (await this.cancelIfRequested(jobId)) return this.current(jobId);
      await this.lifecycle.transition(jobId, "generating", "Contacting AI");
      const provider = this.providerResolver();
      
      const response = await provider.generateText(assembleProviderRequest(context, prompt.content));
      
      if (await this.cancelIfRequested(jobId)) return this.current(jobId);
      const completed = await this.database.transaction(async (transaction) => {
        const [locked] = await transaction.select().from(generationJobs).where(eq(generationJobs.id, jobId)).for("update");
        if (!locked || locked.status === "completed") return locked;
        if (locked.cancelRequestedAt) {
          const [cancelled] = await transaction.update(generationJobs).set({ status: "cancelled", progressStage: "Cancelled", errorCode: "AI_JOB_CANCELLED", errorMessage: "The AI request was cancelled.", finishedAt: new Date() }).where(eq(generationJobs.id, jobId)).returning();
          return cancelled;
        }
        if (locked.status !== "generating") throw new Error("Generation job is not ready to finalize.");
        let resultId = locked.resultMessageId;
        if (!resultId) {
          const [message] = await transaction.insert(aiMessages).values({ conversationId: locked.conversationId!, role: "assistant", content: response.text, metadata: { generationJobId: jobId, provider: response.provider, model: response.model } }).returning();
          if (!message) throw new Error("Assistant message insert failed.");
          resultId = message.id;
        }
        const [updated] = await transaction.update(generationJobs).set({ status: "completed", progressStage: "Completed", resultMessageId: resultId, provider: response.provider, providerModel: response.model, providerRequestId: response.providerRequestId, usageMetadata: response.usage, finishedAt: new Date() }).where(and(eq(generationJobs.id, jobId), eq(generationJobs.status, "generating"))).returning();
        if (!updated) throw new Error("Generation job finalization failed.");
        return updated;
      });
      observe.generationJob(completed?.status === "cancelled" ? "cancelled" : "completed", { jobId, projectId: job.projectId, operation: "assistant", durationMs: performance.now() - startedAt });
      return completed;
    } catch (cause) {
      const error = safeAIError(cause);
      const current = await this.current(jobId);
      if (!current || ["completed", "failed", "cancelled"].includes(current.status)) return current ?? null;
      if (current.cancelRequestedAt || error.code === "AI_JOB_CANCELLED") {
        await this.lifecycle.transition(jobId, "cancelled", "Cancelled", { errorCode: "AI_JOB_CANCELLED", errorMessage: "The AI request was cancelled." });
      } else if (error.retryable && current.attemptCount < MAX_ATTEMPTS) {
        const delay = Math.min(30_000, 1_000 * (2 ** Math.max(0, current.attemptCount - 1))) + Math.floor(Math.random() * 500);
        await this.lifecycle.transition(jobId, "queued", "Queued for retry", { availableAt: new Date(Date.now() + delay), claimedAt: null, workerId: null, errorCode: error.code, errorMessage: error.message });
      } else {
        await this.lifecycle.transition(jobId, "failed", "Failed", { errorCode: error.code, errorMessage: error.message, errorDiagnostic: persistedGenerationDiagnostic(error.diagnostic) });
        observe.generationJob("failed", { jobId, projectId: current.projectId, operation: "assistant", reason: error.code, durationMs: performance.now() - startedAt });
      }
      return this.current(jobId);
    }
  }
}
