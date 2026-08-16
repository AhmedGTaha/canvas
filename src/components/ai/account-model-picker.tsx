"use client";

import { useState } from "react";
import { Check, Image as ImageIcon, Braces } from "lucide-react";
import { Section } from "@/components/ui/panel";
import { Select } from "@/components/ui/form-controls";
import { InlineAlert } from "@/components/ui/feedback";
import { EmptyState } from "@/components/ui/states";
import type { AccountModelSelection } from "@/domain/ai/connections/account-model-service";

/**
 * Which connection and model *you* generate with.
 *
 * One decision, made once, used by every website you work on — including ones you were
 * invited to, where it is still your key and your credit being spent, never the owner's.
 * The model's real capabilities are shown next to it so an image-based request never
 * fails later for a reason nobody could have seen here.
 */
export function AccountModelPicker({ selection, onSelection, onOpenConnections }: {
  selection: AccountModelSelection;
  onSelection: (next: AccountModelSelection) => void;
  onOpenConnections: () => void;
}) {
  const [connectionId, setConnectionId] = useState(selection.connectionId ?? "");
  const [modelRecordId, setModelRecordId] = useState(selection.modelRecordId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  const option = selection.options.find((entry) => entry.connectionId === connectionId);
  const models = option?.models ?? [];
  const chosen = models.find((model) => model.id === modelRecordId) ?? null;

  async function save() {
    setSaving(true); setError(undefined); setSaved(false);
    try {
      const response = await fetch(`/api/account/ai-settings`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId: connectionId || null, modelRecordId: modelRecordId || null }),
      });
      const value = await response.json() as AccountModelSelection & { error?: string };
      if (!response.ok) throw new Error(value.error || "This model selection could not be saved.");
      onSelection(value);
      setSaved(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "This model selection could not be saved."); }
    finally { setSaving(false); }
  }

  if (!selection.options.length) {
    return <EmptyState
      title="No AI connection yet"
      description="Connect an AI provider to your account, enable the models you want to use, then choose one here. Your key is used for the websites you work on, and only yours."
      action={<button type="button" className="button button-primary" onClick={onOpenConnections}>Add a connection</button>}
    />;
  }

  return <>
    <Section title="Your model" description="Every page and section you generate — on any website — uses this model, billed to your provider account.">
      {selection.unavailableReason ? <InlineAlert tone="warning" title="Your model is unavailable">{selection.unavailableReason} Existing pages are untouched; your new AI requests fail until you choose another model.</InlineAlert> : null}

      <div className="ai-field-row">
        <Select
          label="Connection"
          value={connectionId}
          disabled={saving}
          onChange={(event) => { setConnectionId(event.target.value); setModelRecordId(""); setSaved(false); }}
        >
          <option value="">Not selected</option>
          {selection.options.map((entry) => <option key={entry.connectionId} value={entry.connectionId}>{entry.connectionName}</option>)}
        </Select>
        <Select
          label="Model"
          value={modelRecordId}
          disabled={saving || !connectionId}
          hint={connectionId && !models.length ? "This connection has no models enabled yet." : undefined}
          onChange={(event) => { setModelRecordId(event.target.value); setSaved(false); }}
        >
          <option value="">Not selected</option>
          {models.map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>)}
        </Select>
      </div>

      {chosen ? <dl className="detail-list">
        <div><dt><Braces size={14} />Model ID</dt><dd className="ai-mono">{chosen.modelId}</dd></div>
        <div><dt><Check size={14} />Structured output</dt><dd>{chosen.supportsStructuredOutput ? "Supported" : "Not supported — page generation will fail"}</dd></div>
        <div><dt><ImageIcon size={14} />Image input</dt><dd>{chosen.supportsVision ? "Supported" : "Not supported — requests with images are refused"}</dd></div>
        {chosen.contextWindow ? <div><dt>Context</dt><dd>{chosen.contextWindow.toLocaleString()} tokens</dd></div> : null}
        <div><dt>Pricing</dt><dd>{chosen.inputPricePerMillion !== null && chosen.outputPricePerMillion !== null
          ? `${chosen.inputPricePerMillion} in / ${chosen.outputPricePerMillion} out per million tokens (${chosen.pricingCurrency ?? "USD"})`
          : "Not set — cost is reported as unavailable"}</dd></div>
      </dl> : null}

      {error ? <InlineAlert tone="danger" title="That selection was not saved">{error}</InlineAlert> : null}
      {saved && !error ? <InlineAlert tone="success" title="Saved">Your new AI requests use this model.</InlineAlert> : null}

      <div className="form-actions">
        <button type="button" className="button button-primary" disabled={saving} data-pending={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save selection"}</button>
      </div>
    </Section>
  </>;
}
