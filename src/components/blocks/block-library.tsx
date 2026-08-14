"use client";

import { Blocks, Check, Copy, Globe, Link2, LoaderCircle, Moon, MousePointerClick, Plus, RefreshCw, Sun, Trash2, Unlink, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { SegmentedControl } from "@/components/ui/segmented";
import { EmptyState } from "@/components/ui/states";
import { AgentComposer, AgentError, AgentMessage, AgentProgress } from "@/components/workspace/agent-parts";
import { Checkbox, Input, SearchField, Select } from "@/components/ui/form-controls";
import { PREVIEW_IFRAME_SANDBOX } from "@/generated-runtime/security/headers";
import type { ProjectPreviewManifest } from "@/generated-runtime/manifest/schema";
import { parsePreviewParentMessage, type ParentPreviewMessage, type PreviewElementSelection } from "@/generated-runtime/runtime/messages";
import { SelectedElementChip } from "@/components/builder/builder-workspace";
import { HistoryMessages, UndoRedoControls, VersionList } from "@/components/history/history-controls";
import { useHistoryController } from "@/components/history/use-history-controller";
import type { HistoryController } from "@/components/history/use-history-controller";
import type { MediaAsset, MediaFolder } from "@/server/db/schema";
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

export function BlockLibrary({ projectId, initialBlocks, initialBlockId, initialSession, initialPreviewError, initialInstanceId, mediaAssets, mediaFolders }: { projectId: string; initialBlocks: BlockSummary[]; initialBlockId?: string; initialSession: PreviewSession | null; initialPreviewError?: string; initialInstanceId: string; mediaAssets: MediaAsset[]; mediaFolders: MediaFolder[] }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const createDialog = useRef<HTMLDialogElement>(null);
  const [blocks, setBlocks] = useState(initialBlocks);
  const [session, setSession] = useState(initialSession);
  const [instanceId, setInstanceId] = useState(initialInstanceId);
  // The Reusable Sections sidebar opens the panel on the section that was
  // clicked; without it every row landed on whichever block happened to sort
  // first, and the row you picked meant nothing.
  const [selectedId, setSelectedId] = useState<string | null>(
    (initialBlockId && initialBlocks.some((block) => block.id === initialBlockId) ? initialBlockId : initialBlocks[0]?.id) ?? null,
  );
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
      <div className="tool-aside-title">
        <h2>Sections</h2>
        <Button type="button" variant="secondary" size="sm" icon={<Plus size={14} />} onClick={() => createDialog.current?.showModal()}>New</Button>
      </div>
      <SearchField label="Search sections" value={search} onValueChange={setSearch} placeholder="Search sections" />
      {libraryError ? <AgentError>{libraryError}</AgentError> : null}
      {blocks.length === 0
        ? <EmptyState size="inline" icon={<Blocks size={19} />} title="No reusable sections yet" description="Build a navigation bar, footer or call-to-action once, then use it on any page." action={<Button type="button" size="sm" icon={<Plus size={14} />} onClick={() => createDialog.current?.showModal()}>Create a section</Button>} />
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
        {visible.length === 0 ? <li><p className="quiet-note">No sections match that search.</p></li> : null}
        </ul>}
      {selected ? <BlockComposer block={selected} state={aiState} loading={aiLoading} error={aiError} prompt={prompt} selectedMediaIds={selectedMediaIds} assets={mediaAssets} folders={mediaFolders} activeJob={activeJob} summary={latestSummary?.content} selection={selection} selectMode={selectMode} onClearSelection={clearSelection} onPrompt={setPrompt} onMedia={setSelectedMediaIds} onSubmit={() => void submitPrompt()} onCancel={() => void cancelJob()} /> : null}
    </aside>

    <section className="tool-main">
      <div className="tool-bar">
        <div className="tool-title">
          <strong>{selected ? selected.name : "No section selected"}</strong>
          {selected ? <span>{blockKindLabel(selected.kind)}{selected.currentVersionNumber ? ` · version ${selected.currentVersionNumber}` : " · not built yet"}</span> : null}
        </div>
        {/* Undo, appearance and reload act on the section being previewed, so
            they stay out of the way until there is one — on a phone they were
            a row of live-looking controls stacked over an empty canvas. */}
        {selected ? <>
          <UndoRedoControls controller={history} dense />
          <div className="toolbar-divider" />
          <Button type="button" variant={selectMode ? "secondary" : "ghost"} size="sm" aria-pressed={selectMode} icon={<MousePointerClick size={14} />} onClick={toggleSelectMode}>{selectMode ? "Selecting" : "Select a part"}</Button>
          <SegmentedControl label="Appearance" value={theme} onChange={setTheme} options={[{ value: "light", label: "Light", icon: <Sun size={13} /> }, { value: "dark", label: "Dark", icon: <Moon size={13} /> }]} />
          <IconButton label="Reload this section" icon={<RefreshCw size={14} />} onClick={() => void refreshPreview()} />
        </> : null}
      </div>
      {selected ? <div className="preview-status" role="status">{previewStatus === "loading" ? <><LoaderCircle className="spin" size={13} />Loading…</> : previewStatus === "error" ? <><span className="status-error-dot" />Could not load</> : <><Check size={13} />Up to date</>}</div> : null}
      <div className="preview-canvas">
        {previewStatus === "error" ? <div className="preview-error" role="alert"><h2>This section could not be shown</h2><p>{previewError ?? "Your section is safe. Reload it to try again."}</p><Button type="button" size="sm" onClick={() => void refreshPreview()}>Reload</Button></div> : null}
        {/* One invitation to create a section per screen: the list already
            carries the button, so this only says what this space is for. */}
        <div className="preview-device">{frameSrc ? <iframe key={frameSrc} ref={frame} src={frameSrc} sandbox={PREVIEW_IFRAME_SANDBOX} title={`${selected?.name ?? "Section"} preview`} /> : <div className="preview-loading"><Blocks size={20} />{blocks.length ? "Pick a section on the left to see it here." : "Your sections appear here once you create one."}</div>}</div>
      </div>
      {selected ? <BlockDetails key={selected.id} block={selected} usages={usages} busy={busy} history={history}
        onUsageResolution={(usage, resolution) => void action(async () => {
          await request(`/api/projects/${projectId}/blocks/${selected.id}/usages/${encodeURIComponent(usage.usageKey)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pageId: usage.pageId, resolution }) });
          await loadBlockDetail(selected.id);
          await refreshPreview();
        })}
        onRename={(name, kind) => void action(async () => { await request(`/api/projects/${projectId}/blocks/${selected.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, kind }) }); await reloadBlocks(); await refreshPreview(); })}
        onToggleGlobal={() => void action(async () => { await request(`/api/projects/${projectId}/blocks/${selected.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isGlobal: !selected.isGlobal }) }); await reloadBlocks(); await refreshPreview(); })}
        onDuplicate={() => void action(async () => { const copy = await request<BlockSummary>(`/api/projects/${projectId}/blocks/${selected.id}/duplicate`, { method: "POST" }); await reloadBlocks(); await refreshPreview(); return copy; }, (copy) => setSelectedId(copy.id))}
        onArchive={() => void action(async () => { await request(`/api/projects/${projectId}/blocks/${selected.id}`, { method: "DELETE" }); const remaining = await reloadBlocks(); await refreshPreview(); return remaining; }, (remaining) => setSelectedId(remaining[0]?.id ?? null))} /> : null}
    </section>

    <dialog className="dialog" ref={createDialog} onClick={(event) => { if (event.target === createDialog.current) createDialog.current?.close(); }}>
      <div className="dialog-panel">
        <div className="dialog-header"><div><h2>New reusable section</h2><p>Give it a name now; you describe what it should contain next.</p></div><Button variant="ghost" aria-label="Close dialog" onClick={() => createDialog.current?.close()}><X size={18} /></Button></div>
        <form action={(form) => void createBlock(form)}>
          <Input label="Name" name="name" maxLength={120} required placeholder="Main navigation" />
          <Select label="Category" name="kind" defaultValue="section">{SUGGESTED_BLOCK_KINDS.map((kind) => <option key={kind} value={kind}>{blockKindLabel(kind)}</option>)}</Select>
          <Checkbox name="isGlobal" label="Use the same section on every page" description="Pages that use it stay up to date automatically when you change it." />
          <div className="form-actions"><Button type="button" variant="secondary" onClick={() => createDialog.current?.close()}>Cancel</Button><Button type="submit" disabled={busy}>Create</Button></div>
        </form>
      </div>
    </dialog>
  </div>;
}

function BlockDetails({ block, usages, busy, history, onRename, onToggleGlobal, onDuplicate, onArchive, onUsageResolution }: { block: BlockSummary; usages: BlockUsage[]; busy: boolean; history: HistoryController; onRename: (name: string, kind: string) => void; onToggleGlobal: () => void; onDuplicate: () => void; onArchive: () => void; onUsageResolution: (usage: BlockUsage, resolution: "pinned" | "global") => void }) {
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
      {usages.length === 0 ? <p className="quiet-note">Not used on any page yet.</p> : <ul>{usages.map((usage) => <li key={`${usage.pageId}:${usage.usageKey}`}>
        <span>{usage.pageName}</span>
        <small>{usage.route ?? "—"}</small>
        <em>{usage.resolution === "global" ? "Always current" : "Fixed version"}</em>
        {/* Per page, not per block: freezing one page's copy leaves every other
            page following the shared section. */}
        <Button type="button" variant="ghost" className="button-sm" disabled={busy}
          title={usage.resolution === "global" ? `Freeze ${usage.pageName} at the current version` : `Let ${usage.pageName} follow the shared section again`}
          onClick={() => onUsageResolution(usage, usage.resolution === "global" ? "pinned" : "global")}>
          {usage.resolution === "global" ? <><Unlink size={13} />Detach</> : <><Link2 size={13} />Reattach</>}
        </Button>
      </li>)}</ul>}
    </div>
    <details className="blocks-versions" open={showVersions} onToggle={(event) => setShowVersions(event.currentTarget.open)}>
      <summary>Earlier versions</summary>
      {showVersions ? <VersionList controller={history} /> : null}
    </details>
  </div>;
}

function BlockComposer({ block, state, loading, error, prompt, selectedMediaIds, assets, folders, activeJob, summary, selection, selectMode, onPrompt, onMedia, onClearSelection, onSubmit, onCancel }: { block: BlockSummary; state: BlockAIState | null; loading: boolean; error?: string; prompt: string; selectedMediaIds: string[]; assets: MediaAsset[]; folders: MediaFolder[]; activeJob: BlockAIState["job"]; summary?: string; selection: ElementSelection | null; selectMode: boolean; onPrompt: (value: string) => void; onMedia: (ids: string[]) => void; onClearSelection: () => void; onSubmit: () => void; onCancel: () => void }) {
  const created = block.contentStatus === "generated";
  return <section className="blocks-composer" aria-label="Canvas Agent">
    <h3 className="caption">Canvas Agent</h3>
    <div className="blocks-composer-thread">
      {state?.messages.filter((message) => message.role !== "system_internal").slice(-4).map((message) => <AgentMessage key={message.id} role={message.role} content={message.content} />)}
      {loading && !state ? <p className="quiet-note"><LoaderCircle className="spin" size={13} /> Opening this conversation…</p> : null}
      {summary && state?.job?.status === "completed" ? <AgentMessage role="assistant" content={summary} /> : null}
      {activeJob ? <AgentProgress stage={activeJob.progressStage} busy={loading} onCancel={onCancel} /> : null}
      {state?.job?.status === "failed" ? <AgentError>{state.job.errorMessage || "The agent could not update this section, and nothing was changed. Try describing it a different way."}</AgentError> : null}
      {error ? <AgentError>{error}</AgentError> : null}
    </div>
    <AgentComposer
      label={selection ? "Ask the agent to change the selected part" : created ? "Ask the agent to change this section" : "Describe the section you want"}
      placeholder={created ? "Add a Contact link, and tighten the spacing on phones…" : "A navigation bar with the logo and a link to every page…"}
      sendLabel={selection ? "Update this part" : created ? "Update section" : "Create section"}
      prompt={prompt}
      disabled={Boolean(activeJob)}
      busy={loading && !activeJob}
      canSend={Boolean(prompt.trim()) && !activeJob && !loading}
      selectedMediaIds={selectedMediaIds}
      assets={assets}
      folders={folders}
      mediaLimit={BLOCK_MEDIA_ATTACHMENT_LIMIT}
      before={selection ? <SelectedElementChip selection={selection} onClear={onClearSelection} />
        : selectMode ? <p className="quiet-note">Click a highlighted part of the section to edit just that.</p> : null}
      onPrompt={onPrompt}
      onMedia={onMedia}
      onSubmit={onSubmit}
    />
  </section>;
}
