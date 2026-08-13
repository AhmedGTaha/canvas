"use client";

import Image from "next/image";
import { Blocks, Check, CircleAlert, Copy, Globe, LoaderCircle, Moon, MousePointerClick, Plus, RefreshCw, Search, Send, Sparkles, Sun, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form-controls";
import { MultiMediaPicker } from "@/components/media/media-picker";
import { PREVIEW_IFRAME_SANDBOX } from "@/generated-runtime/security/headers";
import type { ProjectPreviewManifest } from "@/generated-runtime/manifest/schema";
import { parsePreviewParentMessage, type ParentPreviewMessage, type PreviewElementSelection } from "@/generated-runtime/runtime/messages";
import { SelectedElementChip } from "@/components/builder/builder-workspace";
import { HistoryMessages, UndoRedoControls, VersionList } from "@/components/history/history-controls";
import { useHistoryController } from "@/components/history/use-history-controller";
import type { HistoryController } from "@/components/history/use-history-controller";
import type { MediaAsset, MediaFolder } from "@/server/db/schema";
import { AI_LIMITS } from "@/domain/ai/limits";
import { BLOCK_MEDIA_ATTACHMENT_LIMIT } from "@/domain/generated-source/limits";
import { SUGGESTED_BLOCK_KINDS, blockKindLabel } from "@/domain/blocks/schemas";

export type BlockSummary = {
  id: string; name: string; kind: string; isGlobal: boolean; currentVersionId: string | null;
  contentStatus: "unbuilt" | "generated"; currentVersionNumber: number | null; usageCount: number;
};
type PreviewSession = { token: string; expiresAt: string; manifest: ProjectPreviewManifest };
type BlockUsage = { usageKey: string; pageId: string; pageName: string; route: string | null; resolution: "pinned" | "global" };
type BlockAIState = {
  block: { id: string; currentVersionId: string | null };
  conversation: { id: string } | null;
  messages: Array<{ id: string; role: "user" | "assistant" | "system_internal"; content: string; createdAt: string }>;
  job: null | { id: string; status: string; progressStage: string; errorMessage: string | null; resultBlockVersionId: string | null };
};
type ElementSelection = Omit<PreviewElementSelection, "type" | "sessionId" | "instanceId">;
type ParentPreviewCommand = ParentPreviewMessage extends infer Message ? Message extends { sessionId: string; instanceId: string } ? Omit<Message, "sessionId" | "instanceId"> : never : never;
const ACTIVE_JOB_STATUSES = new Set(["queued", "preparing_context", "generating", "validating", "applying"]);

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const value = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(value.error || "Canvas could not complete this request.");
  return value;
}

export function BlockLibrary({ projectId, initialBlocks, initialSession, initialPreviewError, initialInstanceId, mediaAssets, mediaFolders }: { projectId: string; initialBlocks: BlockSummary[]; initialSession: PreviewSession | null; initialPreviewError?: string; initialInstanceId: string; mediaAssets: MediaAsset[]; mediaFolders: MediaFolder[] }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const createDialog = useRef<HTMLDialogElement>(null);
  const [blocks, setBlocks] = useState(initialBlocks);
  const [session, setSession] = useState(initialSession);
  const [instanceId, setInstanceId] = useState(initialInstanceId);
  const [selectedId, setSelectedId] = useState<string | null>(initialBlocks[0]?.id ?? null);
  const [search, setSearch] = useState("");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [previewStatus, setPreviewStatus] = useState<"loading" | "ready" | "error">(initialPreviewError ? "error" : "loading");
  const [previewError, setPreviewError] = useState<string | undefined>(initialPreviewError);
  const [libraryError, setLibraryError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [usages, setUsages] = useState<BlockUsage[]>([]);
  const [aiState, setAIState] = useState<BlockAIState | null>(null);
  const [aiLoading, setAILoading] = useState(false);
  const [aiError, setAIError] = useState<string>();
  const [prompt, setPrompt] = useState("");
  const [selectedMediaIds, setSelectedMediaIds] = useState<string[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  const [selection, setSelection] = useState<ElementSelection | null>(null);
  const completedRefresh = useRef<string | null>(null);
  const pendingSelection = useRef<ElementSelection | null>(null);

  const selected = blocks.find((block) => block.id === selectedId) ?? null;
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term ? blocks.filter((block) => block.name.toLowerCase().includes(term) || block.kind.includes(term)) : blocks;
  }, [blocks, search]);
  const frameSrc = session && selectedId ? `/preview/${encodeURIComponent(session.token)}?block=${selectedId}&mode=${theme}&instance=${instanceId}` : null;

  const post = useCallback((message: ParentPreviewCommand, sessionId: string, instance: string) => { frame.current?.contentWindow?.postMessage({ ...message, sessionId, instanceId: instance }, "*"); }, []);
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (!session) return;
      const message = parsePreviewParentMessage(event.data, event.origin, event.source === frame.current?.contentWindow, session.manifest.previewSessionId, instanceId);
      if (!message) return;
      if (message.type === "CANVAS_PREVIEW_READY") {
        setPreviewStatus("ready"); setPreviewError(undefined);
        post({ type: "CANVAS_SET_SELECT_MODE", enabled: selectMode }, session.manifest.previewSessionId, instanceId);
        const restore = pendingSelection.current;
        if (restore) post({ type: "CANVAS_SELECT_ELEMENT", canvasId: restore.canvasId, blockId: restore.blockId }, session.manifest.previewSessionId, instanceId);
      }
      else if (message.type === "CANVAS_PREVIEW_ERROR") { setPreviewStatus("error"); setPreviewError(`${message.message} (${message.detail ?? message.code})`); }
      else if (message.type === "CANVAS_ELEMENT_SELECTED") { const { type, sessionId, instanceId: _instance, ...value } = message; void type; void sessionId; void _instance; pendingSelection.current = value; setSelection(value); }
      else if (message.type === "CANVAS_ELEMENT_CLEARED") { pendingSelection.current = null; setSelection(null); }
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [instanceId, post, selectMode, session]);
  function clearSelection() { pendingSelection.current = null; setSelection(null); if (session) post({ type: "CANVAS_CLEAR_SELECTION" }, session.manifest.previewSessionId, instanceId); }
  function toggleSelectMode() { const next = !selectMode; setSelectMode(next); if (session) post({ type: "CANVAS_SET_SELECT_MODE", enabled: next }, session.manifest.previewSessionId, instanceId); if (!next) clearSelection(); }

  const reloadBlocks = useCallback(async () => {
    const value = await request<{ blocks: BlockSummary[] }>(`/api/projects/${projectId}/blocks`);
    setBlocks(value.blocks);
    return value.blocks;
  }, [projectId]);

  const refreshPreview = useCallback(async () => {
    setPreviewStatus("loading"); setPreviewError(undefined);
    try {
      const value = await request<PreviewSession>(`/api/projects/${projectId}/preview-session`, { method: "POST" });
      setSession(value); setInstanceId(crypto.randomUUID());
    } catch (cause) {
      // The reason reaches the user rather than collapsing into "Preview error".
      setPreviewStatus("error");
      setPreviewError(cause instanceof Error ? cause.message : "Preview could not be prepared.");
    }
  }, [projectId]);

  const onHistoryChanged = useCallback(() => { void reloadBlocks(); void refreshPreview(); }, [refreshPreview, reloadBlocks]);
  const historyTarget = useMemo(() => (selected ? { kind: "block" as const, id: selected.id, name: selected.name } : null), [selected]);
  const history = useHistoryController({ projectId, target: historyTarget, onChanged: onHistoryChanged });

  const loadBlockDetail = useCallback(async (blockId: string) => {
    const [state, detail] = await Promise.all([
      request<BlockAIState>(`/api/projects/${projectId}/blocks/${blockId}/ai`),
      request<{ usages: BlockUsage[] }>(`/api/projects/${projectId}/blocks/${blockId}/usages`),
    ]);
    setAIState(state); setUsages(detail.usages);
    return state;
  }, [projectId]);

  // Composer/history switch cleanly between blocks: block conversations never mix.
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      if (!active) return;
      setAIState(null); setUsages([]); setAIError(undefined); setPrompt(""); setSelectedMediaIds([]); pendingSelection.current = null; setSelection(null);
      if (!selectedId) return;
      setAILoading(true); setPreviewStatus("loading");
      void loadBlockDetail(selectedId)
        .catch((cause: unknown) => { if (active) setAIError(cause instanceof Error ? cause.message : "Building Block history could not be loaded."); })
        .finally(() => { if (active) setAILoading(false); });
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [loadBlockDetail, selectedId]);

  const activeJob = aiState?.job && ACTIVE_JOB_STATUSES.has(aiState.job.status) ? aiState.job : null;
  useEffect(() => {
    if (!selectedId || !activeJob) return;
    const timer = window.setInterval(() => { void loadBlockDetail(selectedId).catch(() => undefined); }, 1_500);
    return () => window.clearInterval(timer);
  }, [activeJob, loadBlockDetail, selectedId]);
  useEffect(() => {
    const job = aiState?.job;
    if (!job || job.status !== "completed" || completedRefresh.current === job.id) return;
    completedRefresh.current = job.id;
    setPrompt(""); setSelectedMediaIds([]);
    void reloadBlocks().catch(() => undefined);
    void refreshPreview();
  }, [aiState?.job, refreshPreview, reloadBlocks]);

  async function action<T>(operation: () => Promise<T>, onDone?: (value: T) => void) {
    setBusy(true); setLibraryError(undefined);
    try { const value = await operation(); onDone?.(value); }
    catch (cause) { setLibraryError(cause instanceof Error ? cause.message : "Canvas could not complete this request."); }
    finally { setBusy(false); }
  }

  async function createBlock(form: FormData) {
    const name = String(form.get("name") ?? ""); const kind = String(form.get("kind") ?? "custom"); const isGlobal = form.get("isGlobal") === "on";
    await action(async () => {
      const block = await request<BlockSummary>(`/api/projects/${projectId}/blocks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, kind, isGlobal }) });
      await reloadBlocks(); await refreshPreview();
      return block;
    }, (block) => { createDialog.current?.close(); setSelectedId(block.id); });
  }

  async function submitPrompt() {
    if (!selectedId || !prompt.trim() || activeJob) return;
    setAILoading(true); setAIError(undefined);
    try {
      await request(`/api/projects/${projectId}/blocks/${selectedId}/ai`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: prompt, selectedMediaIds, selection: selection ? { canvasId: selection.canvasId, blockId: selection.blockId, usageKey: selection.usageKey } : null }) });
      await loadBlockDetail(selectedId);
    } catch (cause) { setAIError(cause instanceof Error ? cause.message : "Canvas could not start this update."); }
    finally { setAILoading(false); }
  }

  async function cancelJob() {
    if (!activeJob || !selectedId) return;
    setAILoading(true);
    try { await request(`/api/projects/${projectId}/generation-jobs/${activeJob.id}`, { method: "DELETE" }); await loadBlockDetail(selectedId); }
    catch (cause) { setAIError(cause instanceof Error ? cause.message : "This update could not be cancelled."); }
    finally { setAILoading(false); }
  }

  const latestSummary = [...(aiState?.messages ?? [])].reverse().find((message) => message.role === "assistant");

  return <div className="blocks-workspace">
    <aside className="blocks-list-panel">
      <div className="builder-panel-title">
        <div><p className="eyebrow">Library</p><h2>Building Blocks</h2></div>
        <Button type="button" variant="secondary" onClick={() => createDialog.current?.showModal()}><Plus size={14} />New</Button>
      </div>
      <label className="tree-search"><Search size={15} /><input type="search" value={search} placeholder="Search blocks" aria-label="Search Building Blocks" onChange={(event) => setSearch(event.target.value)} /></label>
      {libraryError ? <p className="builder-ai-error" role="alert"><CircleAlert size={14} />{libraryError}</p> : null}
      {blocks.length === 0
        ? <div className="blocks-empty"><span className="state-icon"><Blocks size={20} /></span><h3>No Building Blocks yet</h3><p>Create a reusable navbar, footer, card, or section with AI.</p><Button type="button" onClick={() => createDialog.current?.showModal()}><Plus size={14} />Create Building Block</Button></div>
        : <ul className="blocks-list">{visible.map((block) => <li key={block.id}>
          <button type="button" className={block.id === selectedId ? "active" : ""} onClick={() => setSelectedId(block.id)}>
            <span className="blocks-list-name">{block.name}</span>
            <span className="blocks-list-meta">
              <small>{blockKindLabel(block.kind)}</small>
              {block.isGlobal ? <em className="blocks-chip"><Globe size={11} />Shared</em> : null}
              {block.contentStatus === "unbuilt" ? <em className="blocks-chip muted">Draft</em> : null}
              {block.usageCount ? <em className="blocks-chip muted">{block.usageCount} {block.usageCount === 1 ? "page" : "pages"}</em> : null}
            </span>
          </button>
        </li>)}
        {visible.length === 0 ? <li><p className="inline-empty">No blocks match this search.</p></li> : null}
        </ul>}
      {selected ? <BlockComposer block={selected} state={aiState} loading={aiLoading} error={aiError} prompt={prompt} selectedMediaIds={selectedMediaIds} assets={mediaAssets} folders={mediaFolders} activeJob={activeJob} summary={latestSummary?.content} selection={selection} selectMode={selectMode} onClearSelection={clearSelection} onPrompt={setPrompt} onMedia={setSelectedMediaIds} onSubmit={() => void submitPrompt()} onCancel={() => void cancelJob()} /> : null}
    </aside>

    <section className="builder-stage">
      <div className="builder-toolbar">
        <div className="blocks-stage-title">
          <strong>{selected ? selected.name : "Building Blocks"}</strong>
          {selected ? <span>{blockKindLabel(selected.kind)}{selected.currentVersionNumber ? ` · Version ${selected.currentVersionNumber}` : " · Not created yet"}</span> : <span>Select a block to preview it.</span>}
        </div>
        <div className="builder-toolbar-right">
          <UndoRedoControls controller={history} dense />
          <Button type="button" variant={selectMode ? "secondary" : "ghost"} aria-pressed={selectMode} disabled={!selected} onClick={toggleSelectMode}><MousePointerClick size={15} />{selectMode ? "Selecting" : "Select element"}</Button>
          <div className="segmented compact" role="group" aria-label="Preview theme">
            <button type="button" className={theme === "light" ? "active" : ""} onClick={() => setTheme("light")}><Sun size={14} />Light</button>
            <button type="button" className={theme === "dark" ? "active" : ""} onClick={() => setTheme("dark")}><Moon size={14} />Dark</button>
          </div>
          <Button type="button" variant="ghost" onClick={() => void refreshPreview()} aria-label="Refresh preview"><RefreshCw size={15} />Refresh</Button>
        </div>
      </div>
      <div className="preview-status" role="status">{!selected ? <>Nothing selected</> : previewStatus === "loading" ? <><LoaderCircle className="spin" size={13} />Loading preview</> : previewStatus === "error" ? <><span className="status-error-dot" />Preview error</> : <><Check size={13} />Preview ready</>}</div>
      <div className="preview-canvas">
        {previewStatus === "error" ? <div className="preview-error" role="alert"><h2>Preview could not be loaded.</h2><p>{previewError ?? "Return to Canvas and refresh the preview."}</p><Button type="button" onClick={() => void refreshPreview()}>Try again</Button></div> : null}
        <div className="preview-device">{frameSrc ? <iframe key={frameSrc} ref={frame} src={frameSrc} sandbox={PREVIEW_IFRAME_SANDBOX} title={`${selected?.name ?? "Building Block"} preview`} /> : <div className="preview-loading"><Blocks size={20} />Select or create a Building Block.</div>}</div>
      </div>
      {selected ? <BlockDetails key={selected.id} block={selected} usages={usages} busy={busy} history={history}
        onRename={(name, kind) => void action(async () => { await request(`/api/projects/${projectId}/blocks/${selected.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, kind }) }); await reloadBlocks(); await refreshPreview(); })}
        onToggleGlobal={() => void action(async () => { await request(`/api/projects/${projectId}/blocks/${selected.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isGlobal: !selected.isGlobal }) }); await reloadBlocks(); await refreshPreview(); })}
        onDuplicate={() => void action(async () => { const copy = await request<BlockSummary>(`/api/projects/${projectId}/blocks/${selected.id}/duplicate`, { method: "POST" }); await reloadBlocks(); await refreshPreview(); return copy; }, (copy) => setSelectedId(copy.id))}
        onArchive={() => void action(async () => { await request(`/api/projects/${projectId}/blocks/${selected.id}`, { method: "DELETE" }); const remaining = await reloadBlocks(); await refreshPreview(); return remaining; }, (remaining) => setSelectedId(remaining[0]?.id ?? null))} /> : null}
    </section>

    <dialog className="dialog" ref={createDialog} onClick={(event) => { if (event.target === createDialog.current) createDialog.current?.close(); }}>
      <div className="dialog-panel">
        <div className="dialog-header"><div><h2>New Building Block</h2><p>Name it now, then describe it to Canvas.</p></div><Button variant="ghost" aria-label="Close dialog" onClick={() => createDialog.current?.close()}><X size={18} /></Button></div>
        <form action={(form) => void createBlock(form)}>
          <Input label="Name" name="name" maxLength={120} required placeholder="Global Navbar" />
          <Select label="Category" name="kind" defaultValue="section">{SUGGESTED_BLOCK_KINDS.map((kind) => <option key={kind} value={kind}>{blockKindLabel(kind)}</option>)}</Select>
          <label className="checkbox-field"><input type="checkbox" name="isGlobal" /><span>Share across pages — every page using it stays up to date automatically.</span></label>
          <div className="form-actions"><Button type="button" variant="secondary" onClick={() => createDialog.current?.close()}>Cancel</Button><Button type="submit" disabled={busy}>Create</Button></div>
        </form>
      </div>
    </dialog>
  </div>;
}

function BlockDetails({ block, usages, busy, history, onRename, onToggleGlobal, onDuplicate, onArchive }: { block: BlockSummary; usages: BlockUsage[]; busy: boolean; history: HistoryController; onRename: (name: string, kind: string) => void; onToggleGlobal: () => void; onDuplicate: () => void; onArchive: () => void }) {
  const [name, setName] = useState(block.name);
  const [kind, setKind] = useState(block.kind);
  const [showVersions, setShowVersions] = useState(false);
  const { loadVersions } = history;
  useEffect(() => { if (showVersions) loadVersions(); }, [loadVersions, showVersions]);
  return <div className="blocks-details">
    <HistoryMessages controller={history} />
    <form className="blocks-details-form" action={() => onRename(name, kind)}>
      <Input label="Name" name={`block-name-${block.id}`} value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
      <Select label="Category" name={`block-kind-${block.id}`} value={kind} onChange={(event) => setKind(event.target.value)}>{[...new Set([...SUGGESTED_BLOCK_KINDS, kind])].map((value) => <option key={value} value={value}>{blockKindLabel(value)}</option>)}</Select>
      <Button type="submit" variant="secondary" disabled={busy || (name === block.name && kind === block.kind)}>Save</Button>
    </form>
    <div className="blocks-details-actions">
      <Button type="button" variant={block.isGlobal ? "secondary" : "ghost"} onClick={onToggleGlobal} disabled={busy}><Globe size={14} />{block.isGlobal ? "Shared across pages" : "Share across pages"}</Button>
      <Button type="button" variant="ghost" onClick={onDuplicate} disabled={busy}><Copy size={14} />Duplicate</Button>
      <Button type="button" variant="ghost" onClick={onArchive} disabled={busy}><Trash2 size={14} />Archive</Button>
    </div>
    <div className="blocks-usage">
      <h3>Used on</h3>
      {usages.length === 0 ? <p className="inline-empty">Not used on any page yet.</p> : <ul>{usages.map((usage) => <li key={`${usage.pageId}:${usage.usageKey}`}><span>{usage.pageName}</span><small>{usage.route ?? "—"}</small><em>{usage.resolution === "global" ? "Always current" : "Fixed version"}</em></li>)}</ul>}
    </div>
    <details className="blocks-versions" open={showVersions} onToggle={(event) => setShowVersions(event.currentTarget.open)}>
      <summary>Earlier versions</summary>
      {showVersions ? <VersionList controller={history} /> : null}
    </details>
  </div>;
}

function BlockComposer({ block, state, loading, error, prompt, selectedMediaIds, assets, folders, activeJob, summary, selection, selectMode, onPrompt, onMedia, onClearSelection, onSubmit, onCancel }: { block: BlockSummary; state: BlockAIState | null; loading: boolean; error?: string; prompt: string; selectedMediaIds: string[]; assets: MediaAsset[]; folders: MediaFolder[]; activeJob: BlockAIState["job"]; summary?: string; selection: ElementSelection | null; selectMode: boolean; onPrompt: (value: string) => void; onMedia: (ids: string[]) => void; onClearSelection: () => void; onSubmit: () => void; onCancel: () => void }) {
  const created = block.contentStatus === "generated";
  return <section className="builder-ai" aria-label="Canvas AI">
    <div className="builder-ai-title"><Sparkles size={15} /><strong>Canvas</strong></div>
    <div className="builder-ai-history">
      {state?.messages.slice(-6).map((message) => <div key={message.id} className={`builder-ai-message ${message.role === "user" ? "from-user" : "from-canvas"}`}><small>{message.role === "user" ? "You" : "Canvas"}</small><p>{message.content}</p></div>)}
      {loading && !state ? <p className="inline-empty"><LoaderCircle className="spin" size={13} /> Loading history…</p> : null}
    </div>
    {summary && state?.job?.status === "completed" ? <div className="builder-ai-summary"><strong>Canvas updated this block</strong><p>{summary}</p></div> : null}
    {selection ? <SelectedElementChip selection={selection} onClear={onClearSelection} /> : selectMode ? <p className="builder-selection-hint">Click any highlighted region in the preview to select it.</p> : null}
    {activeJob ? <div className="builder-ai-progress" role="status" aria-live="polite"><span><LoaderCircle className="spin" size={14} />{activeJob.progressStage}</span><Button type="button" variant="ghost" onClick={onCancel} disabled={loading}>Cancel</Button></div> : null}
    {state?.job?.status === "failed" ? <p className="builder-ai-error" role="alert"><CircleAlert size={14} />{state.job.errorMessage || "Canvas could not update this block. Try again."}</p> : null}
    {error ? <p className="builder-ai-error" role="alert"><CircleAlert size={14} />{error}</p> : null}
    <label className="field">
      <span className="field-label">{selection ? "Ask Canvas to change the selected element" : created ? "Ask Canvas to change this block" : "Describe the block you want Canvas to create"}</span>
      <textarea className="textarea builder-ai-textarea" value={prompt} maxLength={AI_LIMITS.userMessageCharacters} rows={4} disabled={Boolean(activeJob)}
        placeholder={created ? "Add a Contact link and tighten the mobile spacing…" : "A sticky navbar with the company logo and links to every page…"}
        onChange={(event) => onPrompt(event.target.value)} />
      <span className="field-hint">{prompt.length.toLocaleString()} / {AI_LIMITS.userMessageCharacters.toLocaleString()}</span>
    </label>
    <div className="builder-ai-attachments">{selectedMediaIds.map((id) => { const asset = assets.find((item) => item.id === id); return asset ? <span key={id}><Image src={`/api/media/${id}`} width={24} height={24} alt="" unoptimized /><span>{asset.displayName}</span><button type="button" aria-label={`Remove ${asset.displayName}`} onClick={() => onMedia(selectedMediaIds.filter((item) => item !== id))}><X size={12} /></button></span> : null; })}</div>
    <div className="builder-ai-actions">
      <MultiMediaPicker assets={assets} folders={folders} value={selectedMediaIds} limit={BLOCK_MEDIA_ATTACHMENT_LIMIT} onSelect={onMedia} />
      <Button type="button" onClick={onSubmit} disabled={!prompt.trim() || Boolean(activeJob) || loading}><Send size={14} />{selection ? "Update element" : created ? "Update block" : "Create block"}</Button>
    </div>
  </section>;
}
