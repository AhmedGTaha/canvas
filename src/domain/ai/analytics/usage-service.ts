import { sql as drizzleSql } from "drizzle-orm";
import { db, type Database } from "@/server/db/client";
import { eq } from "drizzle-orm";
import { aiUsageEvents, projects } from "@/server/db/schema";
import type { AIProviderKind, AIReportedCost, AIUsage } from "@/domain/ai/provider";
import { costForRequest, pricingFrom, type ModelPricing } from "./pricing";
import { emit } from "@/server/observability/telemetry";

export type UsageRecordInput = {
  /** Null for an account-scoped request such as the test console. */
  workspaceId: string | null;
  projectId: string | null;
  connectionId: string | null;
  generationJobId?: string | null;
  actorUserId?: string | null;
  provider: AIProviderKind;
  modelId: string;
  requestKind: "generation" | "repair" | "test_console";
  operation: string;
  promptVersion?: string | null;
  succeeded: boolean;
  errorCode?: string | null;
  usage?: AIUsage;
  reportedCost?: AIReportedCost;
  pricing: ModelPricing;
  providerLatencyMs?: number | null;
  jobDurationMs?: number | null;
  validationDurationMs?: number | null;
  startedAt?: Date;
};

function integer(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

/**
 * Writes the durable, normalized record every AI analytic is computed from.
 *
 * It holds identity, timing, tokens, and cost — never a prompt, generated source, or a
 * credential. Recording is best-effort by design: analytics must never be the reason a
 * generation that already succeeded is reported as failed.
 */
export async function recordAIUsage(input: UsageRecordInput, database: Database = db) {
  const cost = costForRequest(input.usage, input.pricing, input.reportedCost);
  const money = (value: number | null) => (value === null ? null : value.toFixed(8));
  const price = (value: number | null) => (value === null ? null : value.toFixed(6));
  try {
    const [row] = await database.insert(aiUsageEvents).values({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      connectionId: input.connectionId,
      generationJobId: input.generationJobId ?? null,
      actorUserId: input.actorUserId ?? null,
      provider: input.provider,
      modelId: input.modelId,
      requestKind: input.requestKind,
      operation: input.operation,
      promptVersion: input.promptVersion ?? null,
      succeeded: input.succeeded,
      errorCode: input.errorCode ?? null,
      inputTokens: integer(input.usage?.inputTokens),
      outputTokens: integer(input.usage?.outputTokens),
      totalTokens: integer(input.usage?.totalTokens ?? ((input.usage?.inputTokens ?? 0) + (input.usage?.outputTokens ?? 0) || undefined)),
      providerLatencyMs: integer(input.providerLatencyMs),
      jobDurationMs: integer(input.jobDurationMs),
      validationDurationMs: integer(input.validationDurationMs),
      costSource: cost.source,
      costAmount: money(cost.amount),
      costCurrency: cost.currency,
      pricingInputPerMillion: price(cost.pricingInputPerMillion),
      pricingOutputPerMillion: price(cost.pricingOutputPerMillion),
      pricingVersion: cost.pricingVersion,
      startedAt: input.startedAt ?? new Date(),
    }).returning();
    return row ?? null;
  } catch (error) {
    emit("ai.usage_record_failed", { projectId: input.projectId, provider: input.provider, reason: error instanceof Error ? error.name : "unknown" }, "warn");
    return null;
  }
}

/**
 * Attaches the whole-job duration to the last provider request of a generation job.
 *
 * Job duration and provider latency are deliberately different measurements: one is the
 * model's round trip, the other is everything Canvas did — context, provider, validation,
 * repair, activation. Neither is ever presented as the other.
 */
export async function attachJobDuration(generationJobId: string, jobDurationMs: number, database: Database = db) {
  try {
    await database.execute(drizzleSql`
      UPDATE ai_usage_events SET job_duration_ms = ${Math.round(jobDurationMs)}
      WHERE id = (SELECT id FROM ai_usage_events WHERE generation_job_id = ${generationJobId} ORDER BY created_at DESC LIMIT 1)`);
  } catch { /* analytics must never fail a generation that already finished */ }
}

export { pricingFrom };

/**
 * The workspace a usage row is attributed to.
 *
 * Usage is now spent from an account's credential, but it is still *about* a project, and
 * the analytics a workspace owner reads are aggregated by workspace. This keeps that
 * reporting intact without letting the workspace have anything to do with which
 * credential was used.
 */
export async function workspaceOfProject(projectId: string, database: Database = db) {
  const [row] = await database.select({ workspaceId: projects.workspaceId }).from(projects).where(eq(projects.id, projectId)).limit(1);
  return row?.workspaceId ?? null;
}
