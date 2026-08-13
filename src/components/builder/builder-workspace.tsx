"use client";

import Link from "next/link";
import Image from "next/image";
import { Blocks, Check, CircleAlert, ExternalLink, FileText, Folder, House, LoaderCircle, Maximize2, Monitor, Moon, MousePointerClick, RefreshCw, Send, Sparkles, Smartphone, Sun, Tablet, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ProjectPreviewManifest, PreviewNavigationItem } from "@/generated-runtime/manifest/schema";
import { parsePreviewParentMessage, type ParentPreviewMessage, type PreviewElementSelection } from "@/generated-runtime/runtime/messages";
import { initialPreviewRoute } from "@/generated-runtime/runtime/router";
import { builderViewReducer, INITIAL_BUILDER_VIEW } from "@/generated-runtime/runtime/builder-state";
import { PREVIEW_IFRAME_SANDBOX } from "@/generated-runtime/security/headers";
import { MultiMediaPicker } from "@/components/media/media-picker";
import { HistoryControls } from "@/components/history/history-controls";
import type { MediaAsset, MediaFolder } from "@/server/db/schema";
import { AI_LIMITS } from "@/domain/ai/limits";
import { PAGE_MEDIA_ATTACHMENT_LIMIT } from "@/domain/page-generation/contract";

type PreviewSession = { token: string; expiresAt: string; manifest: ProjectPreviewManifest };
type ParentPreviewCommand = ParentPreviewMessage extends infer Message ? Message extends { sessionId: string; instanceId: string } ? Omit<Message, "sessionId" | "instanceId"> : never : never;
type BuilderAIState = { conversation: { id: string } | null; messages: Array<{ id: string; role: "user" | "assistant" | "system_internal"; content: string; createdAt: string }>; job: null | { id: string; status: string; progressStage: string; errorMessage: string | null } };
type ElementSelection = Omit<PreviewElementSelection, "type" | "sessionId" | "instanceId">;
/** The entity the composer talks to: the current page, or the block that owns the selection. */
type ComposerTarget = { kind: "page"; id: string } | { kind: "block"; id: string; name: string };
const ACTIVE_JOB_STATUSES = new Set(["queued", "preparing_context", "generating", "validating", "applying"]);

export function BuilderWorkspace({ projectId, initialSession, initialPageId, initialInstanceId, mediaAssets, mediaFolders }: { projectId: string; initialSession: PreviewSession; initialPageId?: string; initialInstanceId: string; mediaAssets: MediaAsset[]; mediaFolders: MediaFolder[] }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const initialRoute = initialPreviewRoute(initialSession.manifest, initialPageId);
  const [session, setSession] = useState(initialSession); const [instanceId, setInstanceId] = useState(initialInstanceId);
  const [route, setRoute] = useState(initialRoute); const [frameSrc, setFrameSrc] = useState(() => `/preview/${encodeURIComponent(initialSession.token)}?route=${encodeURIComponent(initialRoute)}&mode=light&instance=${initialInstanceId}`);
  const [view, dispatchView] = useReducer(builderViewReducer, INITIAL_BUILDER_VIEW);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading"); const [error, setError] = useState<string>();
  const currentPageId = session.manifest.routes[route]?.pageId ?? null;
  const currentPage = session.manifest.pages.find((page) => page.pageId === currentPageId) ?? null;
  const [selectMode, setSelectMode] = useState(false);
  const [selection, setSelection] = useState<ElementSelection | null>(null);
  const [aiState, setAIState] = useState<BuilderAIState | null>(null); const [aiLoading, setAILoading] = useState(false); const [prompt, setPrompt] = useState(""); const [selectedMediaIds, setSelectedMediaIds] = useState<string[]>([]); const [aiError, setAIError] = useState<string>();
  const completedRefresh = useRef<string | null>(null);
  const pendingSelection = useRef<ElementSelection | null>(null);

  // Selecting inside a shared Building Block retargets the composer at that block, so a
  // global component is edited once instead of being copied into this page.
  const target: ComposerTarget | null = selection?.blockId
    ? { kind: "block", id: selection.blockId, name: session.manifest.blocks[selection.blockId]?.name ?? "Building Block" }
    : currentPageId ? { kind: "page", id: currentPageId } : null;
  const targetKey = target ? `${target.kind}:${target.id}` : null;
  const stateUrl = target ? (target.kind === "block" ? `/api/projects/${projectId}/blocks/${target.id}/ai` : `/api/projects/${projectId}/pages/${target.id}/ai`) : null;

  const makeSrc = useCallback((token: string, nextRoute: string, mode: "light" | "dark", instance: string) => `/preview/${encodeURIComponent(token)}?route=${encodeURIComponent(nextRoute)}&mode=${mode}&instance=${instance}`, []);
  const post = useCallback((message: ParentPreviewCommand, sessionId: string, instance: string) => { frame.current?.contentWindow?.postMessage({ ...message, sessionId, instanceId: instance }, "*"); }, []);

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      const message = parsePreviewParentMessage(event.data, event.origin, event.source === frame.current?.contentWindow, session.manifest.previewSessionId, instanceId);
      if (!message) return;
      if (message.type === "CANVAS_PREVIEW_READY") {
        setStatus("ready");
        // A fresh Preview instance starts in interaction mode with nothing selected.
        post({ type: "CANVAS_SET_SELECT_MODE", enabled: selectMode }, session.manifest.previewSessionId, instanceId);
        const restore = pendingSelection.current;
        if (restore) post({ type: "CANVAS_SELECT_ELEMENT", canvasId: restore.canvasId, blockId: restore.blockId }, session.manifest.previewSessionId, instanceId);
      }
      else if (message.type === "CANVAS_PREVIEW_ERROR") { setStatus("error"); setError(`${message.message} (${message.detail ?? message.code})`); }
      else if (message.type === "CANVAS_ELEMENT_SELECTED") { const { type, sessionId, instanceId: _instance, ...value } = message; void type; void sessionId; void _instance; pendingSelection.current = value; setSelection(value); }
      else if (message.type === "CANVAS_ELEMENT_CLEARED") { pendingSelection.current = null; setSelection(null); }
      else if (message.type === "CANVAS_ROUTE_CHANGED") {
        // A selection never survives moving to another page.
        if (message.pageId !== currentPageId) { pendingSelection.current = null; setSelection(null); }
        setRoute(message.route); const page = message.pageId; const url = new URL(window.location.href); if (page) url.searchParams.set("page", page); else url.searchParams.delete("page"); window.history.replaceState(window.history.state, "", url);
      }
    };
    window.addEventListener("message", listener); return () => window.removeEventListener("message", listener);
  }, [currentPageId, instanceId, post, selectMode, session.manifest.previewSessionId]);
  useEffect(() => { const listener = (event: KeyboardEvent) => { if (event.key === "Escape") dispatchView({ type: "EXIT_FULL_SCREEN" }); }; window.addEventListener("keydown", listener); return () => window.removeEventListener("keydown", listener); }, []);

  function send(message: ParentPreviewCommand) { post(message, session.manifest.previewSessionId, instanceId); }
  function navigate(next: string) { pendingSelection.current = null; setSelection(null); setRoute(next); send({ type: "CANVAS_NAVIGATE", route: next }); }
  function changeTheme(mode: "light" | "dark") { dispatchView({ type: "SET_THEME", theme: mode }); send({ type: "CANVAS_SET_THEME", mode }); }
  function toggleSelectMode() { const next = !selectMode; setSelectMode(next); send({ type: "CANVAS_SET_SELECT_MODE", enabled: next }); if (!next) clearSelection(); }
  function clearSelection() { pendingSelection.current = null; setSelection(null); send({ type: "CANVAS_CLEAR_SELECTION" }); }

  const refresh = useCallback(async () => {
    setStatus("loading"); setError(undefined);
    try {
      const response = await fetch(`/api/projects/${projectId}/preview-session`, { method: "POST" }); const value = await response.json() as PreviewSession & { error?: string };
      if (!response.ok) throw new Error(value.error || "Preview could not be prepared.");
      const retained = value.manifest.routes[route] ? route : initialPreviewRoute(value.manifest, currentPageId); const nextInstance = crypto.randomUUID();
      setSession(value); setRoute(retained); setInstanceId(nextInstance); setFrameSrc(makeSrc(value.token, retained, view.theme, nextInstance));
    } catch (cause) { setStatus("error"); setError(cause instanceof Error ? cause.message : "Preview could not be prepared."); }
  }, [currentPageId, makeSrc, projectId, route, view.theme]);

  const loadAIState = useCallback(async (url: string) => {
    const response = await fetch(url, { cache: "no-store" }); const value = await response.json() as BuilderAIState & { error?: string };
    if (!response.ok) throw new Error(value.error || "Canvas history could not be loaded."); setAIState(value); return value;
  }, []);
  // Switching page or selected block switches the composer history cleanly.
  useEffect(() => {
    if (!stateUrl) return; let active = true;
    const timer = window.setTimeout(() => { if (active) { setAIState(null); setAIError(undefined); setPrompt(""); setSelectedMediaIds([]); setAILoading(true); } void loadAIState(stateUrl).catch((cause: unknown) => { if (active) setAIError(cause instanceof Error ? cause.message : "Canvas history could not be loaded."); }).finally(() => { if (active) setAILoading(false); }); }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [loadAIState, stateUrl, targetKey]);

  const activeJob = aiState?.job && ACTIVE_JOB_STATUSES.has(aiState.job.status) ? aiState.job : null;
  useEffect(() => { if (!stateUrl || !activeJob) return; const timer = window.setInterval(() => { void loadAIState(stateUrl).catch(() => undefined); }, 1_500); return () => window.clearInterval(timer); }, [activeJob, loadAIState, stateUrl]);
  useEffect(() => { const job = aiState?.job; if (!job || job.status !== "completed" || completedRefresh.current === job.id) return; completedRefresh.current = job.id; setPrompt(""); setSelectedMediaIds([]); void refresh(); }, [aiState?.job, refresh]);

  async function submitPrompt() {
    if (!target || !stateUrl || !prompt.trim() || activeJob) return; setAILoading(true); setAIError(undefined);
    try {
      const body = { content: prompt, selectedMediaIds, selection: selection ? { canvasId: selection.canvasId, blockId: selection.blockId, usageKey: selection.usageKey } : null };
      const response = await fetch(stateUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const value = await response.json() as { error?: string }; if (!response.ok) throw new Error(value.error || "Canvas could not start this update.");
      await loadAIState(stateUrl);
    }
    catch (cause) { setAIError(cause instanceof Error ? cause.message : "Canvas could not start this update."); } finally { setAILoading(false); }
  }
  async function cancelJob() { if (!activeJob || !stateUrl) return; setAILoading(true); try { const response = await fetch(`/api/projects/${projectId}/generation-jobs/${activeJob.id}`, { method: "DELETE" }); const value = await response.json() as { error?: string }; if (!response.ok) throw new Error(value.error || "This update could not be cancelled."); await loadAIState(stateUrl); } catch (cause) { setAIError(cause instanceof Error ? cause.message : "This update could not be cancelled."); } finally { setAILoading(false); } }
  const modeClass = useMemo(() => `preview-device preview-${view.device}`, [view.device]);
  return <div className={`builder-workspace ${view.fullScreen ? "builder-fullscreen" : ""}`}>
    <aside className="builder-pages"><div className="builder-panel-title"><div><p className="eyebrow">Builder</p><h2>Pages</h2></div><Link href={`/projects/${projectId}/pages`} aria-label="Manage pages"><ExternalLink size={15} /></Link></div><BuilderNavigation items={session.manifest.navigation} currentPageId={currentPageId} onNavigate={navigate} /><BuilderAIComposer page={currentPage} target={target} selection={selection} selectMode={selectMode} state={aiState} loading={aiLoading} error={aiError} prompt={prompt} selectedMediaIds={selectedMediaIds} assets={mediaAssets} folders={mediaFolders} activeJob={activeJob} onPrompt={setPrompt} onMedia={setSelectedMediaIds} onClearSelection={clearSelection} onSubmit={() => void submitPrompt()} onCancel={() => void cancelJob()} /></aside>
    <section className="builder-stage"><div className="builder-toolbar"><div className="builder-device-controls" role="group" aria-label="Preview device"><ToolbarButton active={view.device === "desktop"} label="Desktop" icon={<Monitor size={15} />} onClick={() => dispatchView({ type: "SET_DEVICE", device: "desktop" })} /><ToolbarButton active={view.device === "tablet"} label="Tablet" icon={<Tablet size={15} />} onClick={() => dispatchView({ type: "SET_DEVICE", device: "tablet" })} /><ToolbarButton active={view.device === "mobile"} label="Mobile" icon={<Smartphone size={15} />} onClick={() => dispatchView({ type: "SET_DEVICE", device: "mobile" })} /></div><div className="builder-toolbar-right"><HistoryControls projectId={projectId} target={currentPageId ? { kind: "page", id: currentPageId, name: currentPage?.name } : null} onChanged={() => void refresh()} showCheckpoints /><Button type="button" variant={selectMode ? "secondary" : "ghost"} aria-pressed={selectMode} onClick={toggleSelectMode}><MousePointerClick size={15} />{selectMode ? "Selecting" : "Select element"}</Button><div className="segmented compact" role="group" aria-label="Preview theme"><button type="button" className={view.theme === "light" ? "active" : ""} onClick={() => changeTheme("light")}><Sun size={14} />Light</button><button type="button" className={view.theme === "dark" ? "active" : ""} onClick={() => changeTheme("dark")}><Moon size={14} />Dark</button></div><Button type="button" variant="ghost" onClick={() => void refresh()} aria-label="Refresh preview"><RefreshCw size={15} />Refresh</Button><Button type="button" variant="secondary" onClick={() => dispatchView({ type: "TOGGLE_FULL_SCREEN" })}>{view.fullScreen ? <X size={15} /> : <Maximize2 size={15} />}{view.fullScreen ? "Exit Full Screen" : "Full Screen"}</Button></div></div>
      <div className="preview-status" role="status">{status === "loading" ? <><LoaderCircle className="spin" size={13} />Loading preview</> : status === "error" ? <><span className="status-error-dot" />Preview error</> : <><Check size={13} />Preview ready</>}</div>
      <div className="preview-canvas">{status === "error" ? <div className="preview-error" role="alert"><h2>Preview could not be loaded.</h2><p>{error}</p><Button type="button" onClick={() => void refresh()}>Try again</Button></div> : null}<div className={modeClass}>{frameSrc ? <iframe ref={frame} src={frameSrc} sandbox={PREVIEW_IFRAME_SANDBOX} title={`${session.manifest.brand.companyName} website preview`} /> : <div className="preview-loading"><LoaderCircle className="spin" />Loading preview…</div>}</div></div>
    </section>
  </div>;
}

export function SelectedElementChip({ selection, blockName, onClear }: { selection: { canvasId: string; elementType: string; label: string | null; blockId: string | null }; blockName?: string; onClear: () => void }) {
  return <div className="builder-selection" role="status">
    <span className="builder-selection-body">
      <MousePointerClick size={13} />
      <span><strong>{selection.label ?? selection.elementType}</strong><small>{selection.blockId ? `In shared block${blockName ? `: ${blockName}` : ""}` : selection.canvasId}</small></span>
    </span>
    <button type="button" aria-label="Clear selected element" onClick={onClear}><X size={13} /></button>
  </div>;
}

function BuilderAIComposer({ page, target, selection, selectMode, state, loading, error, prompt, selectedMediaIds, assets, folders, activeJob, onPrompt, onMedia, onClearSelection, onSubmit, onCancel }: { page: ProjectPreviewManifest["pages"][number] | null; target: ComposerTarget | null; selection: ElementSelection | null; selectMode: boolean; state: BuilderAIState | null; loading: boolean; error?: string; prompt: string; selectedMediaIds: string[]; assets: MediaAsset[]; folders: MediaFolder[]; activeJob: BuilderAIState["job"]; onPrompt: (value: string) => void; onMedia: (ids: string[]) => void; onClearSelection: () => void; onSubmit: () => void; onCancel: () => void }) {
  const latestSummary = [...(state?.messages ?? [])].reverse().find((message) => message.role === "assistant");
  const editingBlock = target?.kind === "block";
  const built = editingBlock || page?.contentStatus === "generated";
  const label = selection ? "Ask Canvas to change the selected element" : built ? (editingBlock ? "Ask Canvas to change this shared block" : "Ask Canvas to change this page") : "Describe the page you want Canvas to create";
  const placeholder = selection ? "Make this card more compact…" : built ? "Make the hero shorter and improve the mobile spacing…" : "Create a modern homepage with a hero, services, and contact call-to-action…";
  return <section className="builder-ai" aria-label="Canvas AI">
    <div className="builder-ai-title"><Sparkles size={15} /><strong>Canvas</strong>{editingBlock ? <span className="builder-ai-scope"><Blocks size={12} />{target.name}</span> : null}</div>
    <div className="builder-ai-history">{state?.messages.slice(-6).map((message) => <div key={message.id} className={`builder-ai-message ${message.role === "user" ? "from-user" : "from-canvas"}`}><small>{message.role === "user" ? "You" : "Canvas"}</small><p>{message.content}</p></div>)}{loading && !state ? <p className="inline-empty"><LoaderCircle className="spin" size={13} /> Loading history…</p> : null}</div>
    {latestSummary && state?.job?.status === "completed" ? <div className="builder-ai-summary"><strong>Canvas updated {editingBlock ? "this block" : "this page"}</strong><p>{latestSummary.content}</p></div> : null}
    {selection ? <SelectedElementChip selection={selection} blockName={editingBlock ? target.name : undefined} onClear={onClearSelection} /> : selectMode ? <p className="builder-selection-hint">Click any highlighted region in the preview to select it.</p> : null}
    {activeJob ? <div className="builder-ai-progress" role="status" aria-live="polite"><span><LoaderCircle className="spin" size={14} />{activeJob.progressStage}</span><Button type="button" variant="ghost" onClick={onCancel} disabled={loading}>Cancel</Button></div> : null}
    {state?.job?.status === "failed" ? <p className="builder-ai-error" role="alert"><CircleAlert size={14} />{state.job.errorMessage || "Canvas could not apply this change. Try again."}</p> : null}
    {error ? <p className="builder-ai-error" role="alert"><CircleAlert size={14} />{error}</p> : null}
    <div className="field"><label className="field-label" htmlFor="canvas-ai-prompt">{label}</label><textarea id="canvas-ai-prompt" aria-describedby="canvas-ai-prompt-hint" className="textarea builder-ai-textarea" value={prompt} maxLength={AI_LIMITS.userMessageCharacters} rows={4} disabled={!target || Boolean(activeJob)} placeholder={placeholder} onChange={(event) => onPrompt(event.target.value)} /><span className="field-hint" id="canvas-ai-prompt-hint">{prompt.length.toLocaleString()} of {AI_LIMITS.userMessageCharacters.toLocaleString()} characters used</span></div>
    <div className="builder-ai-attachments">{selectedMediaIds.map((id) => { const asset = assets.find((item) => item.id === id); return asset ? <span key={id}><Image src={`/api/media/${id}`} width={24} height={24} alt="" unoptimized /><span>{asset.displayName}</span><button type="button" aria-label={`Remove ${asset.displayName}`} onClick={() => onMedia(selectedMediaIds.filter((item) => item !== id))}><X size={12} /></button></span> : null; })}</div>
    <div className="builder-ai-actions"><MultiMediaPicker assets={assets} folders={folders} value={selectedMediaIds} limit={PAGE_MEDIA_ATTACHMENT_LIMIT} onSelect={onMedia} /><Button type="button" onClick={onSubmit} disabled={!target || !prompt.trim() || Boolean(activeJob) || loading}><Send size={14} />{selection ? "Update element" : built ? (editingBlock ? "Update block" : "Update page") : "Create page"}</Button></div>
  </section>;
}

function ToolbarButton({ active, label, icon, onClick }: { active: boolean; label: string; icon: React.ReactNode; onClick: () => void }) { return <button type="button" className={active ? "active" : ""} aria-pressed={active} onClick={onClick}>{icon}{label}</button>; }
function BuilderNavigation({ items, currentPageId, onNavigate }: { items: PreviewNavigationItem[]; currentPageId: string | null; onNavigate: (route: string) => void }) { return <ul className="builder-page-tree">{items.map((item) => <li key={item.id}>{item.type === "group" ? <><span className="builder-folder"><Folder size={14} />{item.label}</span><BuilderNavigation items={item.children} currentPageId={currentPageId} onNavigate={onNavigate} /></> : <><button type="button" className={item.id === currentPageId ? "active" : ""} onClick={() => onNavigate(item.route)}>{item.route === "/" ? <House size={14} /> : <FileText size={14} />}<span>{item.label}</span>{item.route === "/" ? <small>Home</small> : null}</button>{item.children.length ? <BuilderNavigation items={item.children} currentPageId={currentPageId} onNavigate={onNavigate} /> : null}</>}</li>)}</ul>; }
