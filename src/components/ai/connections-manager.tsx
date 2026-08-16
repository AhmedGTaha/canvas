"use client";

import { useState } from "react";
import { KeyRound, Plus, RefreshCw } from "lucide-react";
import { Section } from "@/components/ui/panel";
import { Input, Select, Checkbox } from "@/components/ui/form-controls";
import { InlineAlert } from "@/components/ui/feedback";
import { EmptyState } from "@/components/ui/states";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Button } from "@/components/ui/button";
import type { ConnectionView, ModelView } from "@/domain/ai/connections/connection-service";
import type { ProviderDescriptor } from "@/server/ai/provider-registry";

type Draft = { provider: string; name: string; baseUrl: string; apiKey: string };

const EMPTY_DRAFT: Draft = { provider: "gemini", name: "", baseUrl: "", apiKey: "" };

/**
 * Workspace AI connections.
 *
 * A stored API key is never sent back to the browser, so this screen only ever shows a
 * four-character hint and when it was last changed. Editing a connection without
 * retyping the key keeps the stored one; typing a new one replaces it and resets the
 * connection's test state, because an untested new credential is not a tested one.
 */
export function ConnectionsManager({ providers, connections, onConnections }: {
  providers: ProviderDescriptor[];
  connections: ConnectionView[];
  onConnections: (next: ConnectionView[]) => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const descriptor = (kind: string) => providers.find((entry) => entry.kind === kind);
  const base = "/api/account/ai-connections";

  async function call<T>(url: string, init: RequestInit, failure: string): Promise<T> {
    const response = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
    const value = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(value.error || failure);
    return value;
  }
  async function reload() {
    const value = await call<{ connections: ConnectionView[] }>(base, { method: "GET" }, "AI connections could not be loaded.");
    onConnections(value.connections);
  }
  async function run(key: string, action: () => Promise<void>, success?: string) {
    setBusy(key); setError(undefined); setNotice(undefined);
    try { await action(); if (success) setNotice(success); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "That did not work."); }
    finally { setBusy(null); }
  }

  async function createConnection() {
    if (!draft) return;
    await run("create", async () => {
      await call(base, { method: "POST", body: JSON.stringify({ provider: draft.provider, name: draft.name, baseUrl: draft.baseUrl || null, apiKey: draft.apiKey }) }, "This AI connection could not be saved.");
      setDraft(null);
      await reload();
    }, "Connection added. Load its models, then enable the ones projects may use.");
  }

  return <>
    <Section
      title="Provider connections"
      description="Canvas uses your own provider account. Keys are encrypted before they are stored and never sent back to a browser."
      actions={draft ? undefined : <button type="button" className="button button-secondary button-sm" onClick={() => setDraft(EMPTY_DRAFT)}><Plus size={14} />Add connection</button>}
    >
      {error ? <InlineAlert tone="danger" title="That did not work">{error}</InlineAlert> : null}
      {notice ? <InlineAlert tone="success" title="Done">{notice}</InlineAlert> : null}

      {draft ? <div className="ai-card">
        <div className="ai-field-row">
          <Select label="Provider" value={draft.provider} onChange={(event) => setDraft({ ...draft, provider: event.target.value, baseUrl: "" })}>
            {providers.map((entry) => <option key={entry.kind} value={entry.kind}>{entry.label}</option>)}
          </Select>
          <Input label="Name" value={draft.name} placeholder="Team key" onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </div>
        {descriptor(draft.provider)?.baseUrl.supported ? <Input
          label="Base URL"
          value={draft.baseUrl}
          optional={!descriptor(draft.provider)?.baseUrl.required}
          placeholder={descriptor(draft.provider)?.baseUrl.placeholder}
          hint={descriptor(draft.provider)?.baseUrl.required ? "Required for this provider." : "Leave empty to use the provider's own endpoint."}
          onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
        /> : null}
        <Input
          label={descriptor(draft.provider)?.credentialLabel ?? "API key"}
          type="password"
          autoComplete="off"
          value={draft.apiKey}
          hint={descriptor(draft.provider)?.help}
          onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
        />
        <div className="form-actions">
          <button type="button" className="button button-primary" disabled={busy === "create"} data-pending={busy === "create"} onClick={() => void createConnection()}>Save connection</button>
          <button type="button" className="button button-ghost" onClick={() => { setDraft(null); setError(undefined); }}>Cancel</button>
        </div>
      </div> : null}

      {connections.length === 0 && !draft
        ? <EmptyState title="No connections yet" description="Add your provider account so websites in this workspace can generate pages." action={<button type="button" className="button button-primary" onClick={() => setDraft(EMPTY_DRAFT)}>Add connection</button>} />
        : connections.map((connection) => <ConnectionCard
            key={connection.id}
            connection={connection}
            descriptor={descriptor(connection.provider)}
            busy={busy}
            onBusy={run}
            onReload={reload}
            onRemove={() => void run(`remove:${connection.id}`, async () => {
              await call(`${base}/${connection.id}`, { method: "DELETE" }, "This connection could not be removed.");
              await reload();
            }, "Connection removed.")}
            base={base}
            call={call}
          />)}
    </Section>

  </>;
}

function ConnectionCard({ connection, descriptor, busy, onBusy, onReload, onRemove, base, call }: {
  connection: ConnectionView;
  descriptor?: ProviderDescriptor;
  busy: string | null;
  onBusy: (key: string, action: () => Promise<void>, success?: string) => Promise<void>;
  onReload: () => Promise<void>;
  onRemove: () => void;
  base: string;
  call: <T>(url: string, init: RequestInit, failure: string) => Promise<T>;
}) {
  const [rotating, setRotating] = useState(false);
  const [nextKey, setNextKey] = useState("");
  const [newModelId, setNewModelId] = useState("");
  const enabled = connection.models.filter((model) => model.enabled).length;

  return <div className="ai-card">
    <div className="ai-card-head">
      <div>
        <strong>{connection.name}</strong>
        <small>{descriptor?.label ?? connection.provider}{connection.baseUrl ? ` · ${connection.baseUrl}` : ""}</small>
      </div>
      <span className={`status-indicator`}>
        <span className={`status-dot ${connection.lastTestStatus === "passed" ? "status-dot-success" : connection.lastTestStatus === "failed" ? "status-dot-danger" : ""}`} />
        {connection.lastTestStatus === "passed" ? "Working" : connection.lastTestStatus === "failed" ? "Failed" : "Not tested"}
      </span>
    </div>

    <dl className="detail-list">
      <div><dt><KeyRound size={14} />API key</dt><dd className="ai-mono">{connection.credentialHint}</dd></div>
      <div><dt>Models enabled</dt><dd>{enabled} of {connection.models.length}</dd></div>
      {connection.lastTestError ? <div><dt>Last failure</dt><dd>{connection.lastTestError}</dd></div> : null}
    </dl>

    <div className="ai-actions">
      <button type="button" className="button button-secondary button-sm" disabled={busy === `test:${connection.id}`} data-pending={busy === `test:${connection.id}`}
        onClick={() => void onBusy(`test:${connection.id}`, async () => { await call(`${base}/${connection.id}/test`, { method: "POST" }, "This connection could not be tested."); await onReload(); })}>
        Test connection
      </button>
      {connection.supportsModelListing ? <button type="button" className="button button-secondary button-sm" disabled={busy === `models:${connection.id}`} data-pending={busy === `models:${connection.id}`}
        onClick={() => void onBusy(`models:${connection.id}`, async () => { await call(`${base}/${connection.id}/models/discover`, { method: "POST" }, "Models could not be loaded."); await onReload(); }, "Models loaded. Enable the ones projects may use.")}>
        <RefreshCw size={14} />Load models
      </button> : null}
      <button type="button" className="button button-ghost button-sm" onClick={() => setRotating((current) => !current)}>Replace key</button>
      <ConfirmationDialog
        title="Remove this connection?"
        triggerLabel="Remove"
        description={`Websites using ${connection.name} keep every page they already have, but their AI requests fail until another model is chosen.`}
        action={<Button variant="danger" onClick={onRemove}>Remove connection</Button>}
      />
    </div>

    {rotating ? <div className="ai-inline-form">
      <Input label="New API key" type="password" autoComplete="off" value={nextKey} hint="Replacing the key clears this connection's test result." onChange={(event) => setNextKey(event.target.value)} />
      <button type="button" className="button button-primary button-sm" disabled={!nextKey || busy === `rotate:${connection.id}`}
        onClick={() => void onBusy(`rotate:${connection.id}`, async () => {
          await call(`${base}/${connection.id}`, { method: "PATCH", body: JSON.stringify({ apiKey: nextKey }) }, "This key could not be replaced.");
          setNextKey(""); setRotating(false); await onReload();
        }, "Key replaced.")}>Save key</button>
    </div> : null}

    <div className="ai-models">
      <div className="ai-models-head">
        <h4>Models projects may use</h4>
      </div>
      {connection.models.length === 0
        ? <p className="text-muted text-sm">No models yet. {connection.supportsModelListing ? "Load them from the provider, or add a model ID by hand." : "Add a model ID by hand."}</p>
        : <ul className="list">
            {connection.models.map((model) => <ModelRow key={model.id} model={model} busy={busy} onBusy={onBusy} onReload={onReload} base={`${base}/${connection.id}/models/${model.id}`} call={call} />)}
          </ul>}
      <div className="ai-inline-form">
        <Input label="Add a model ID" value={newModelId} placeholder="gpt-5" hint="Use the exact model ID the provider expects." onChange={(event) => setNewModelId(event.target.value)} />
        <button type="button" className="button button-secondary button-sm" disabled={!newModelId || busy === `add:${connection.id}`}
          onClick={() => void onBusy(`add:${connection.id}`, async () => {
            await call(`${base}/${connection.id}/models`, { method: "POST", body: JSON.stringify({ modelId: newModelId, enabled: true }) }, "This model could not be added.");
            setNewModelId(""); await onReload();
          })}><Plus size={14} />Add</button>
      </div>
    </div>
  </div>;
}

function ModelRow({ model, busy, onBusy, onReload, base, call }: {
  model: ModelView;
  busy: string | null;
  onBusy: (key: string, action: () => Promise<void>, success?: string) => Promise<void>;
  onReload: () => Promise<void>;
  base: string;
  call: <T>(url: string, init: RequestInit, failure: string) => Promise<T>;
}) {
  const [open, setOpen] = useState(false);
  const [pricing, setPricing] = useState({ input: model.inputPricePerMillion?.toString() ?? "", output: model.outputPricePerMillion?.toString() ?? "" });

  async function patch(body: Record<string, unknown>, key: string) {
    await onBusy(key, async () => { await call(base, { method: "PATCH", body: JSON.stringify(body) }, "This model could not be updated."); await onReload(); });
  }

  return <li className="ai-model-row">
    <div className="ai-model-main">
      <Checkbox
        label={model.displayName}
        description={model.modelId}
        checked={model.enabled}
        disabled={busy === `enable:${model.id}`}
        onChange={(event) => void patch({ enabled: event.target.checked }, `enable:${model.id}`)}
      />
      <button type="button" className="button button-ghost button-sm" aria-expanded={open} onClick={() => setOpen((current) => !current)}>{open ? "Hide details" : "Details"}</button>
    </div>
    {open ? <div className="ai-model-detail">
      <Checkbox label="Structured output" description="Required for page and section generation." checked={model.supportsStructuredOutput}
        onChange={(event) => void patch({ supportsStructuredOutput: event.target.checked }, `structured:${model.id}`)} />
      <Checkbox label="Image input" description="Required when a request attaches images." checked={model.supportsVision}
        onChange={(event) => void patch({ supportsVision: event.target.checked }, `vision:${model.id}`)} />
      <div className="ai-field-row">
        <Input label="Input price per million tokens" inputMode="decimal" value={pricing.input} optional hint="Leave empty to report cost as unavailable." onChange={(event) => setPricing({ ...pricing, input: event.target.value })} />
        <Input label="Output price per million tokens" inputMode="decimal" value={pricing.output} optional onChange={(event) => setPricing({ ...pricing, output: event.target.value })} />
      </div>
      <div className="form-actions">
        <button type="button" className="button button-secondary button-sm" disabled={busy === `pricing:${model.id}`}
          onClick={() => void patch({
            inputPricePerMillion: pricing.input === "" ? null : Number(pricing.input),
            outputPricePerMillion: pricing.output === "" ? null : Number(pricing.output),
          }, `pricing:${model.id}`)}>Save pricing</button>
        <button type="button" className="button button-ghost button-sm" disabled={busy === `remove:${model.id}`}
          onClick={() => void onBusy(`remove:${model.id}`, async () => { await call(base, { method: "DELETE" }, "This model could not be removed."); await onReload(); })}>Remove model</button>
      </div>
      <p className="text-muted text-sm">Cost estimates already recorded keep the pricing they were calculated with, so past usage does not change when you edit these numbers.</p>
    </div> : null}
  </li>;
}
