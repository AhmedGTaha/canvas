import { sql } from "@/server/db/client";
import { ProjectAccessService } from "@/server/permissions/project-access";
import { DomainError } from "@/domain/shared/errors";

export const ANALYTICS_PERIODS = { "24h": 24, "7d": 24 * 7, "30d": 24 * 30 } as const;
export type AnalyticsPeriod = keyof typeof ANALYTICS_PERIODS;

export function parseAnalyticsPeriod(value: string | null | undefined): AnalyticsPeriod {
  return value && value in ANALYTICS_PERIODS ? value as AnalyticsPeriod : "7d";
}

export type LatencySummary = {
  /** Provider round trip only. Never the whole Canvas generation. */
  providerAverageMs: number | null;
  providerP50Ms: number | null;
  providerP95Ms: number | null;
  /** Whole durable job: context, provider, validation, activation. */
  jobAverageMs: number | null;
  validationAverageMs: number | null;
};

export type CostTotal = { source: "provider_reported" | "canvas_estimate"; currency: string; amount: number; requests: number };

export type AIAnalyticsSummary = {
  period: AnalyticsPeriod;
  requests: { total: number; succeeded: number; failed: number; successRate: number | null };
  tokens: { input: number; output: number; total: number };
  latency: LatencySummary;
  costs: CostTotal[];
  requestsWithUnknownCost: number;
  breakdown: Array<{ provider: string; model: string; requests: number; succeeded: number; failed: number; inputTokens: number; outputTokens: number; totalTokens: number; providerP50Ms: number | null; providerP95Ms: number | null; estimatedCost: number | null; costCurrency: string | null; requestsWithUnknownCost: number }>;
  recent: Array<{ id: string; createdAt: string; provider: string; model: string; operation: string; requestKind: string; promptVersion: string | null; succeeded: boolean; errorCode: string | null; inputTokens: number | null; outputTokens: number | null; totalTokens: number | null; providerLatencyMs: number | null; jobDurationMs: number | null; costAmount: number | null; costCurrency: string | null; costSource: string | null }>;
};

const number = (value: unknown) => (value === null || value === undefined ? null : Number(value));
const count = (value: unknown) => Number(value ?? 0);

/**
 * AI analytics, over exactly one scope at a time.
 *
 * Two scopes exist and neither can see the other's rows. A project summary is filtered by
 * the project the caller was authorized for, so one project's usage never appears in
 * another's numbers. An account summary is filtered by `actor_user_id`, so a person sees
 * what *they* spent — which is the honest view now that the credential spent on a job
 * belongs to whoever started it.
 *
 * Measurements are reported only where they were actually recorded: a missing latency or
 * token count stays null rather than being inferred, and unknown cost is never summed as
 * zero.
 */
export class AIAnalyticsService {
  constructor(private readonly access = new ProjectAccessService()) {}

  async summary(userId: string, projectId: string, period: AnalyticsPeriod = "7d"): Promise<AIAnalyticsSummary> {
    await this.access.requireProjectAccess(userId, projectId);
    return this.aggregate(sql`project_id = ${projectId}`, period);
  }

  /** This account's own usage, across every project it has worked in. */
  async accountSummary(userId: string, period: AnalyticsPeriod = "7d"): Promise<AIAnalyticsSummary> {
    return this.aggregate(sql`actor_user_id = ${userId}`, period);
  }

  private async aggregate(scope: ReturnType<typeof sql>, period: AnalyticsPeriod): Promise<AIAnalyticsSummary> {
    const hours = ANALYTICS_PERIODS[period];
    if (!hours) throw new DomainError("VALIDATION", "Unknown analytics period.");
    const since = sql`now() - (${hours} * interval '1 hour')`;

    const [totals] = await sql<Array<Record<string, unknown>>>`
      SELECT
        count(*) AS total,
        count(*) FILTER (WHERE succeeded) AS succeeded,
        coalesce(sum(input_tokens), 0) AS input_tokens,
        coalesce(sum(output_tokens), 0) AS output_tokens,
        coalesce(sum(total_tokens), 0) AS total_tokens,
        avg(provider_latency_ms) AS provider_avg,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY provider_latency_ms) AS provider_p50,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY provider_latency_ms) AS provider_p95,
        avg(job_duration_ms) AS job_avg,
        avg(validation_duration_ms) AS validation_avg,
        count(*) FILTER (WHERE cost_amount IS NULL) AS unknown_cost
      FROM ai_usage_events
      WHERE ${scope} AND created_at >= ${since}`;

    const costs = await sql<Array<Record<string, unknown>>>`
      SELECT cost_source, cost_currency, sum(cost_amount) AS amount, count(*) AS requests
      FROM ai_usage_events
      WHERE ${scope} AND created_at >= ${since} AND cost_amount IS NOT NULL
      GROUP BY cost_source, cost_currency`;

    const breakdown = await sql<Array<Record<string, unknown>>>`
      SELECT provider, model_id,
        count(*) AS requests,
        count(*) FILTER (WHERE succeeded) AS succeeded,
        coalesce(sum(input_tokens), 0) AS input_tokens,
        coalesce(sum(output_tokens), 0) AS output_tokens,
        coalesce(sum(total_tokens), 0) AS total_tokens,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY provider_latency_ms) AS provider_p50,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY provider_latency_ms) AS provider_p95,
        sum(cost_amount) AS cost_amount,
        max(cost_currency) AS cost_currency,
        count(*) FILTER (WHERE cost_amount IS NULL) AS unknown_cost
      FROM ai_usage_events
      WHERE ${scope} AND created_at >= ${since}
      GROUP BY provider, model_id
      ORDER BY requests DESC
      LIMIT 20`;

    const recent = await sql<Array<Record<string, unknown>>>`
      SELECT id, created_at, provider, model_id, operation, request_kind, prompt_version, succeeded, error_code,
             input_tokens, output_tokens, total_tokens, provider_latency_ms, job_duration_ms,
             cost_amount, cost_currency, cost_source
      FROM ai_usage_events
      WHERE ${scope} AND created_at >= ${since}
      ORDER BY created_at DESC
      LIMIT 20`;

    const total = count(totals?.total);
    const succeeded = count(totals?.succeeded);
    return {
      period,
      requests: { total, succeeded, failed: total - succeeded, successRate: total ? succeeded / total : null },
      tokens: { input: count(totals?.input_tokens), output: count(totals?.output_tokens), total: count(totals?.total_tokens) },
      latency: {
        providerAverageMs: round(number(totals?.provider_avg)),
        providerP50Ms: round(number(totals?.provider_p50)),
        providerP95Ms: round(number(totals?.provider_p95)),
        jobAverageMs: round(number(totals?.job_avg)),
        validationAverageMs: round(number(totals?.validation_avg)),
      },
      costs: costs.map((row) => ({
        source: String(row.cost_source) as CostTotal["source"],
        currency: String(row.cost_currency ?? "USD"),
        amount: Number(row.amount ?? 0),
        requests: count(row.requests),
      })),
      requestsWithUnknownCost: count(totals?.unknown_cost),
      breakdown: breakdown.map((row) => ({
        provider: String(row.provider), model: String(row.model_id),
        requests: count(row.requests), succeeded: count(row.succeeded), failed: count(row.requests) - count(row.succeeded),
        inputTokens: count(row.input_tokens), outputTokens: count(row.output_tokens), totalTokens: count(row.total_tokens),
        providerP50Ms: round(number(row.provider_p50)), providerP95Ms: round(number(row.provider_p95)),
        estimatedCost: number(row.cost_amount), costCurrency: row.cost_currency ? String(row.cost_currency) : null,
        requestsWithUnknownCost: count(row.unknown_cost),
      })),
      recent: recent.map((row) => ({
        id: String(row.id), createdAt: new Date(row.created_at as string).toISOString(),
        provider: String(row.provider), model: String(row.model_id), operation: String(row.operation), requestKind: String(row.request_kind),
        promptVersion: row.prompt_version ? String(row.prompt_version) : null,
        succeeded: Boolean(row.succeeded), errorCode: row.error_code ? String(row.error_code) : null,
        inputTokens: number(row.input_tokens), outputTokens: number(row.output_tokens), totalTokens: number(row.total_tokens),
        providerLatencyMs: number(row.provider_latency_ms), jobDurationMs: number(row.job_duration_ms),
        costAmount: number(row.cost_amount), costCurrency: row.cost_currency ? String(row.cost_currency) : null,
        costSource: row.cost_source ? String(row.cost_source) : null,
      })),
    };
  }
}

function round(value: number | null) { return value === null ? null : Math.round(value); }
