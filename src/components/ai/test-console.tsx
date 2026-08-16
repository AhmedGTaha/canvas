"use client";

import { useState } from "react";
import { Section } from "@/components/ui/panel";
import { Textarea } from "@/components/ui/form-controls";
import { InlineAlert } from "@/components/ui/feedback";
import { formatCost } from "@/domain/ai/analytics/pricing";
import type { ProjectModelSelection } from "@/domain/ai/connections/project-model-service";
import type { TestPromptResult } from "@/domain/ai/connections/test-console-service";

/**
 * A direct line to the selected model.
 *
 * Send a prompt, see exactly what came back and what it cost. Nothing here touches the
 * website: no page version, no change set, no agent history. Measurements the provider
 * did not report are shown as unavailable rather than filled in with a plausible number.
 */
export function TestConsole({ projectId, selection }: { projectId: string; selection: ProjectModelSelection }) {
  const [prompt, setPrompt] = useState("In one sentence, what is a landing page for?");
  const [result, setResult] = useState<TestPromptResult | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();

  const ready = Boolean(selection.model && !selection.unavailableReason);

  async function send() {
    setSending(true); setError(undefined);
    try {
      const response = await fetch(`/api/projects/${projectId}/ai-settings/test`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }),
      });
      const value = await response.json() as TestPromptResult & { error?: string };
      if (!response.ok) throw new Error(value.error || "This test request could not be sent.");
      setResult(value);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "This test request could not be sent."); }
    finally { setSending(false); }
  }

  return <Section
    title="Test model"
    description={ready ? `Sends one prompt straight to ${selection.model?.displayName} on ${selection.connectionName}. It changes nothing on this website.` : "Choose a connection and model first."}
  >
    {!ready ? <InlineAlert tone="info" title="No model selected">Pick a connection and model on the Model tab, then come back here.</InlineAlert> : null}

    <Textarea
      label="Test prompt"
      rows={3}
      value={prompt}
      disabled={!ready || sending}
      hint="Test prompts are not added to the agent conversation for this website."
      onChange={(event) => setPrompt(event.target.value)}
    />
    <div className="form-actions">
      <button type="button" className="button button-primary" disabled={!ready || sending || !prompt.trim()} data-pending={sending} onClick={() => void send()}>
        {sending ? "Sending…" : "Send test prompt"}
      </button>
    </div>

    {error ? <InlineAlert tone="danger" title="That request could not be sent">{error}</InlineAlert> : null}

    {result ? <div className="ai-card">
      <div className="ai-card-head">
        <div>
          <strong>{result.status === "succeeded" ? "Response" : "Request failed"}</strong>
          <small>{result.provider} · {result.model} · {new Date(result.timestamp).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</small>
        </div>
        <span className="status-indicator">
          <span className={`status-dot ${result.status === "succeeded" ? "status-dot-success" : "status-dot-danger"}`} />
          {result.status === "succeeded" ? "Succeeded" : result.error?.code ?? "Failed"}
        </span>
      </div>

      {result.status === "succeeded" ? <pre className="ai-response">{result.response}</pre> : <InlineAlert tone="danger" title="The provider refused this request">{result.error?.message}</InlineAlert>}

      <dl className="detail-list">
        <div><dt>Total latency</dt><dd>{result.totalLatencyMs} ms</dd></div>
        <div><dt>Time to first token</dt><dd>{result.timeToFirstTokenMs === null ? "Unavailable — this request was not streamed" : `${result.timeToFirstTokenMs} ms`}</dd></div>
        <div><dt>Input tokens</dt><dd>{result.inputTokens ?? "Unavailable"}</dd></div>
        <div><dt>Output tokens</dt><dd>{result.outputTokens ?? "Unavailable"}</dd></div>
        <div><dt>Total tokens</dt><dd>{result.totalTokens ?? "Unavailable"}</dd></div>
        <div><dt>Cost</dt><dd>{formatCost(result.cost.amount, result.cost.currency)}{result.cost.source === "canvas_estimate" ? " (Canvas estimate)" : result.cost.source === "provider_reported" ? " (provider reported)" : ""}</dd></div>
      </dl>
    </div> : null}
  </Section>;
}
