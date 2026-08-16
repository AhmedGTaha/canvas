"use client";

import { useState } from "react";
import { Check, Image as ImageIcon, Braces } from "lucide-react";
import { Section } from "@/components/ui/panel";
import { Select } from "@/components/ui/form-controls";
import { InlineAlert } from "@/components/ui/feedback";
import { EmptyState } from "@/components/ui/states";
import type { ProjectModelSelection } from "@/domain/ai/connections/project-model-service";

/**
 * Which connection and model this website generates with. One decision, stated in the
 * words a website owner uses, with the model's real capabilities shown next to it so an
 * image-based request never fails later for a reason nobody could have seen here.
 */
export function ProjectModelPicker({ projectId, selection, onSelection, canManageConnections, onOpenConnections }: {
  projectId: string;
  selection: ProjectModelSelection;
  onSelection: (next: ProjectModelSelection) => void;
  canManageConnections: boolean;
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
      const response = await fetch(`/api/projects/${projectId}/ai-settings`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId: connectionId || null, modelRecordId: modelRecordId || null }),
      });
      const value = await response.json() as ProjectModelSelection & { error?: string };
      if (!response.ok) throw new Error(value.error || "This model selection could not be saved.");
      onSelection(value);
      setSaved(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "This model selection could not be saved."); }
    finally { setSaving(false); }
  }

  if (!selection.options.length) {
    return <EmptyState
      title="No AI connection yet"
      description={canManageConnections
        ? "Connect an AI provider for this workspace, enable the models projects may use, then choose one here."
        : "The workspace owner has not connected an AI provider yet. Until they do, this website cannot generate pages."}
      action={canManageConnections ? <button type="button" className="button button-primary" onClick={onOpenConnections}>Add a connection</button> : undefined}
    />;
  }

  return <>
    <Section title="Model for this website" description="Every page and section this website generates uses this model.">
      {selection.unavailableReason ? <InlineAlert tone="warning" title="This website's model is unavailable">{selection.unavailableReason} Existing pages are untouched; new AI requests fail until you choose another model.</InlineAlert> : null}
      {!selection.canSelect ? <InlineAlert tone="info" title="Only the website owner can change this">You can see which model this website uses, and its usage, but not change the selection.</InlineAlert> : null}

      <div className="ai-field-row">
        <Select
          label="Connection"
          value={connectionId}
          disabled={!selection.canSelect || saving}
          onChange={(event) => { setConnectionId(event.target.value); setModelRecordId(""); setSaved(false); }}
        >
          <option value="">Not selected</option>
          {selection.options.map((entry) => <option key={entry.connectionId} value={entry.connectionId}>{entry.connectionName}</option>)}
        </Select>
        <Select
          label="Model"
          value={modelRecordId}
          disabled={!selection.canSelect || saving || !connectionId}
          hint={connectionId && !models.length ? "This connection has no models enabled for projects yet." : undefined}
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
      {saved && !error ? <InlineAlert tone="success" title="Saved">New AI requests for this website use this model.</InlineAlert> : null}

      {selection.canSelect ? <div className="form-actions">
        <button type="button" className="button button-primary" disabled={saving} data-pending={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save selection"}</button>
      </div> : null}
    </Section>
  </>;
}
