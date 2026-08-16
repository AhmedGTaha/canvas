"use client";

import { useCallback, useEffect, useState } from "react";
import { Section } from "@/components/ui/panel";
import { SegmentedControl } from "@/components/ui/segmented";
import { InlineAlert } from "@/components/ui/feedback";
import { EmptyState, LoadingState } from "@/components/ui/states";
import { formatCost } from "@/domain/ai/analytics/pricing";
import type { AIAnalyticsSummary, AnalyticsPeriod } from "@/domain/ai/analytics/analytics-service";

const PERIODS: Array<{ value: AnalyticsPeriod; label: string }> = [
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
];

const OPERATION_LABELS: Record<string, string> = {
  page_generate: "Page created", page_modify: "Page updated",
  block_generate: "Section created", block_modify: "Section updated",
  assistant: "Assistant reply", test_console: "Test prompt",
};

function milliseconds(value: number | null) { return value === null ? "—" : value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${value} ms`; }
function count(value: number) { return value.toLocaleString(); }

/**
 * What this website's AI actually did.
 *
 * The headline view answers four questions — how much was asked, how much worked, how
 * long it took, what it cost — and everything finer sits below it. Two rules hold
 * throughout: model latency and total Canvas time are never the same number, and an
 * estimate is never presented as a bill.
 */
export function AIAnalytics({ projectId, initial }: { projectId: string; initial: AIAnalyticsSummary | null }) {
  const [period, setPeriod] = useState<AnalyticsPeriod>(initial?.period ?? "7d");
  const [summary, setSummary] = useState(initial);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState<string>();

  const load = useCallback(async (next: AnalyticsPeriod) => {
    setLoading(true); setError(undefined);
    try {
      const response = await fetch(`/api/projects/${projectId}/ai-settings/analytics?period=${next}`, { cache: "no-store" });
      const value = await response.json() as AIAnalyticsSummary & { error?: string };
      if (!response.ok) throw new Error(value.error || "AI usage could not be loaded.");
      setSummary(value);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "AI usage could not be loaded."); }
    finally { setLoading(false); }
  }, [projectId]);

  // The panel is rendered with a server-loaded summary; this only covers the case where
  // that load failed, and it is deferred so the first paint is not a cascading render.
  useEffect(() => {
    if (initial) return;
    const timer = window.setTimeout(() => void load(period), 0);
    return () => window.clearTimeout(timer);
  }, [initial, load, period]);

  const estimated = summary?.costs.filter((entry) => entry.source === "canvas_estimate") ?? [];
  const reported = summary?.costs.filter((entry) => entry.source === "provider_reported") ?? [];

  return <>
    <Section
      title="AI usage"
      description="Requests this website sent to its AI model, and what came back."
      actions={<SegmentedControl
        label="Period"
        value={period}
        options={PERIODS}
        onChange={(next) => { setPeriod(next); void load(next); }}
      />}
    >
      {error ? <InlineAlert tone="danger" title="Usage could not be loaded">{error}</InlineAlert> : null}
      {loading && !summary ? <LoadingState label="Loading AI usage…" /> : null}

      {summary && summary.requests.total === 0
        ? <EmptyState title="No AI requests in this period" description="Ask the agent to build or change a page, and its usage appears here." />
        : null}

      {summary && summary.requests.total > 0 ? <>
        <div className="ai-metrics">
          <Metric label="Requests" value={count(summary.requests.total)} note={`${count(summary.requests.succeeded)} succeeded · ${count(summary.requests.failed)} failed`} />
          <Metric label="Success rate" value={summary.requests.successRate === null ? "—" : `${Math.round(summary.requests.successRate * 100)}%`} />
          <Metric label="Model latency, median" value={milliseconds(summary.latency.providerP50Ms)} note={`p95 ${milliseconds(summary.latency.providerP95Ms)}`} />
          <Metric label="Tokens" value={count(summary.tokens.total)} note={`${count(summary.tokens.input)} in · ${count(summary.tokens.output)} out`} />
        </div>

        <div className="ai-metrics">
          <Metric
            label="Estimated cost"
            value={estimated.length ? estimated.map((entry) => formatCost(entry.amount, entry.currency)).join(" · ") : "Unavailable"}
            note={estimated.length ? "Calculated by Canvas from the pricing you entered. Not a bill." : "Set model pricing to see an estimate."}
          />
          {reported.length ? <Metric label="Provider-reported cost" value={reported.map((entry) => formatCost(entry.amount, entry.currency)).join(" · ")} note="Charged amount as the provider reported it." /> : null}
          <Metric label="Average total time" value={milliseconds(summary.latency.jobAverageMs)} note="Whole Canvas generation, not just the model." />
          <Metric label="Average validation time" value={milliseconds(summary.latency.validationAverageMs)} />
        </div>

        {summary.requestsWithUnknownCost > 0
          ? <InlineAlert tone="info" title="Some requests have no cost">
              {count(summary.requestsWithUnknownCost)} of {count(summary.requests.total)} requests have no pricing recorded, so they are excluded from the totals above rather than counted as free.
            </InlineAlert>
          : null}

        <details className="ai-details">
          <summary>By provider and model</summary>
          <div className="ai-table-scroll">
            <table className="ai-table">
              <thead><tr><th scope="col">Provider</th><th scope="col">Model</th><th scope="col">Requests</th><th scope="col">Failed</th><th scope="col">Tokens</th><th scope="col">p50</th><th scope="col">p95</th><th scope="col">Cost</th></tr></thead>
              <tbody>
                {summary.breakdown.map((row) => <tr key={`${row.provider}:${row.model}`}>
                  <td>{row.provider}</td>
                  <td className="ai-mono">{row.model}</td>
                  <td>{count(row.requests)}</td>
                  <td>{count(row.failed)}</td>
                  <td>{count(row.totalTokens)}</td>
                  <td>{milliseconds(row.providerP50Ms)}</td>
                  <td>{milliseconds(row.providerP95Ms)}</td>
                  <td>{formatCost(row.estimatedCost, row.costCurrency)}</td>
                </tr>)}
              </tbody>
            </table>
          </div>
        </details>

        <details className="ai-details">
          <summary>Recent requests</summary>
          <div className="ai-table-scroll">
            <table className="ai-table">
              <thead><tr><th scope="col">When</th><th scope="col">What</th><th scope="col">Model</th><th scope="col">Result</th><th scope="col">Model latency</th><th scope="col">Total</th><th scope="col">Tokens</th><th scope="col">Cost</th></tr></thead>
              <tbody>
                {summary.recent.map((row) => <tr key={row.id}>
                  <td>{new Date(row.createdAt).toLocaleString("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                  <td>{OPERATION_LABELS[row.operation] ?? row.operation}{row.requestKind === "repair" ? " (repair)" : ""}</td>
                  <td className="ai-mono">{row.model}</td>
                  <td>{row.succeeded ? "Succeeded" : row.errorCode ?? "Failed"}</td>
                  <td>{milliseconds(row.providerLatencyMs)}</td>
                  <td>{milliseconds(row.jobDurationMs)}</td>
                  <td>{row.totalTokens === null ? "—" : count(row.totalTokens)}</td>
                  <td>{formatCost(row.costAmount, row.costCurrency)}{row.costSource === "canvas_estimate" ? " est." : ""}</td>
                </tr>)}
              </tbody>
            </table>
          </div>
        </details>
      </> : null}
    </Section>
  </>;
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="ai-metric">
    <span className="ai-metric-label">{label}</span>
    <strong className="ai-metric-value">{value}</strong>
    {note ? <small>{note}</small> : null}
  </div>;
}
