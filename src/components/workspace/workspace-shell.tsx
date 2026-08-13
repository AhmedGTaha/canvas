"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Blocks, Copy, Download, FileCog, FilePlus2, FolderPlus, House, Images, Keyboard, LayoutGrid, ListTree, LogOut, Maximize2, Monitor, Moon, Palette, PanelLeft, PanelRight, Redo2, RefreshCw, Save, Settings, Smartphone, Sparkles, Sun, Tablet, Type, Undo2, UserRound, UsersRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useTransition } from "react";
import { signOutAction } from "@/app/actions/auth";
import { pageTreeAction } from "@/app/actions/pages";
import { HistoryControls, type HistoryApi } from "@/components/history/history-controls";
import { AgentPanel, type AgentMessage, type AgentJob, type AgentTarget } from "./agent-panel";
import { Explorer } from "./explorer";
import { MenuBar, type MenuEntry, type MenuGroup } from "./menu-bar";
import { PreviewStage, type Device } from "./preview-stage";
import type { ProjectPreviewManifest } from "@/generated-runtime/manifest/schema";
import { parsePreviewParentMessage, type ParentPreviewMessage, type PreviewElementSelection } from "@/generated-runtime/runtime/messages";
import { initialPreviewRoute } from "@/generated-runtime/runtime/router";
import { builderViewReducer, INITIAL_BUILDER_VIEW } from "@/generated-runtime/runtime/builder-state";
import type { MediaAsset, MediaFolder, PageNode } from "@/server/db/schema";

type PreviewSession = { token: string; expiresAt: string; manifest: ProjectPreviewManifest };
type ParentPreviewCommand = ParentPreviewMessage extends infer Message ? Message extends { sessionId: string; instanceId: string } ? Omit<Message, "sessionId" | "instanceId"> : never : never;
type AgentState = { conversation: { id: string } | null; messages: AgentMessage[]; job: AgentJob };
type ElementSelection = Omit<PreviewElementSelection, "type" | "sessionId" | "instanceId">;
type ComposerTarget = { kind: "page"; id: string } | { kind: "block"; id: string; name: string };

const ACTIVE_JOB_STATUSES = new Set(["queued", "preparing_context", "generating", "validating", "applying"]);
const LAYOUT_KEY = "canvas.workspace.layout";
const EXPLORER_RANGE = [190, 460] as const;
const AGENT_RANGE = [300, 640] as const;

type Layout = { explorer: boolean; agent: boolean; explorerWidth: number; agentWidth: number };
const DEFAULT_LAYOUT: Layout = { explorer: true, agent: true, explorerWidth: 262, agentWidth: 384 };

const modifier = () => (typeof navigator !== "undefined" && /Mac|iP(hone|ad)/.test(navigator.platform || navigator.userAgent) ? "⌘" : "Ctrl+");

/**
 * The Canvas project workspace.
 *
 * One screen owns the whole editing experience: the website structure on the
 * left, the website in the middle, the agent on the right, and every project
 * tool reachable from the menu bar as an overlay panel. Opening a tool never
 * unmounts this component, so the preview session, the conversation and the
 * current page all survive.
 */
export function WorkspaceShell({
  projectId, projectName, projectStatus, userName, initialSession, initialPageId, initialInstanceId, nodes, mediaAssets, mediaFolders, canManageProject,
}: {
  projectId: string;
  projectName: string;
  projectStatus: string;
  userName: string;
  initialSession: PreviewSession;
  initialPageId?: string;
  initialInstanceId: string;
  nodes: PageNode[];
  mediaAssets: MediaAsset[];
  mediaFolders: MediaFolder[];
  canManageProject: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  const frame = useRef<HTMLIFrameElement>(null);
  const initialRoute = initialPreviewRoute(initialSession.manifest, initialPageId);

  const [session, setSession] = useState(initialSession);
  const [instanceId, setInstanceId] = useState(initialInstanceId);
  const [route, setRoute] = useState(initialRoute);
  const [frameSrc, setFrameSrc] = useState(() => `/preview/${encodeURIComponent(initialSession.token)}?route=${encodeURIComponent(initialRoute)}&mode=light&instance=${initialInstanceId}`);
  const [view, dispatchView] = useReducer(builderViewReducer, INITIAL_BUILDER_VIEW);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string>();
  const [selectMode, setSelectMode] = useState(false);
  const [selection, setSelection] = useState<ElementSelection | null>(null);
  const [agentState, setAgentState] = useState<AgentState | null>(null);
  const [agentLoading, setAgentLoading] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [selectedMediaIds, setSelectedMediaIds] = useState<string[]>([]);
  const [agentError, setAgentError] = useState<string>();
  const [layout, setLayout] = useState<Layout>(DEFAULT_LAYOUT);
  const [history, setHistory] = useState<HistoryApi | null>(null);
  // HistoryControls republishes its API whenever its own inputs change. Holding
  // the previous object when nothing meaningful moved stops a publish from
  // re-rendering this component, which would republish, and so on. The identity
  // guard is what keeps that loop impossible rather than merely unlikely.
  const publishHistoryApi = useCallback((api: HistoryApi) => {
    setHistory((current) => (current && sameHistory(current, api) ? current : api));
  }, []);
  const completedRefresh = useRef<string | null>(null);
  const pendingSelection = useRef<ElementSelection | null>(null);

  const currentPageId = session.manifest.routes[route]?.pageId ?? null;
  const currentPage = session.manifest.pages.find((page) => page.pageId === currentPageId) ?? null;
  const currentNode = nodes.find((node) => node.id === currentPageId) ?? null;

  /* ------------------------------------------------------------- layout */
  // Restoring a saved panel layout has to happen after hydration — the server
  // has no access to localStorage, so reading it during render would produce a
  // mismatched tree. This is the one-time preference read the React docs call
  // out as a legitimate effect; it cannot cascade because it runs once.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(LAYOUT_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (stored) setLayout({ ...DEFAULT_LAYOUT, ...JSON.parse(stored) as Partial<Layout> });
    } catch { /* a corrupt preference is not worth surfacing; the default is fine */ }
  }, []);

  // Mirrors the layout so the drag handlers can persist the final width without
  // depending on a stale closure.
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const persistLayout = useCallback((next: Layout) => {
    try { window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  }, []);
  const saveLayout = useCallback((next: Layout) => {
    setLayout(next);
    persistLayout(next);
  }, [persistLayout]);
  const toggleExplorer = useCallback(() => saveLayout({ ...layout, explorer: !layout.explorer }), [layout, saveLayout]);
  const toggleAgent = useCallback(() => saveLayout({ ...layout, agent: !layout.agent }), [layout, saveLayout]);

  const [resizing, setResizing] = useState<"explorer" | "agent" | null>(null);
  useEffect(() => {
    if (!resizing) return;
    function onMove(event: PointerEvent) {
      if (resizing === "explorer") {
        const width = Math.min(EXPLORER_RANGE[1], Math.max(EXPLORER_RANGE[0], event.clientX));
        setLayout((current) => ({ ...current, explorerWidth: width }));
      } else {
        const width = Math.min(AGENT_RANGE[1], Math.max(AGENT_RANGE[0], window.innerWidth - event.clientX));
        setLayout((current) => ({ ...current, agentWidth: width }));
      }
    }
    // The width is written once, when the drag ends, not on every pointer move.
    function onUp() { setResizing(null); persistLayout(layoutRef.current); }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
  }, [persistLayout, resizing]);

  /* ------------------------------------------------------------ preview */
  const makeSrc = useCallback((token: string, nextRoute: string, mode: "light" | "dark", instance: string) => `/preview/${encodeURIComponent(token)}?route=${encodeURIComponent(nextRoute)}&mode=${mode}&instance=${instance}`, []);
  const post = useCallback((message: ParentPreviewCommand, sessionId: string, instance: string) => { frame.current?.contentWindow?.postMessage({ ...message, sessionId, instanceId: instance }, "*"); }, []);

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      const message = parsePreviewParentMessage(event.data, event.origin, event.source === frame.current?.contentWindow, session.manifest.previewSessionId, instanceId);
      if (!message) return;
      if (message.type === "CANVAS_PREVIEW_READY") {
        setStatus("ready");
        post({ type: "CANVAS_SET_SELECT_MODE", enabled: selectMode }, session.manifest.previewSessionId, instanceId);
        const restore = pendingSelection.current;
        if (restore) post({ type: "CANVAS_SELECT_ELEMENT", canvasId: restore.canvasId, blockId: restore.blockId }, session.manifest.previewSessionId, instanceId);
      }
      else if (message.type === "CANVAS_PREVIEW_ERROR") { setStatus("error"); setError(`${message.message} (${message.detail ?? message.code})`); }
      else if (message.type === "CANVAS_ELEMENT_SELECTED") { const { type, sessionId, instanceId: _instance, ...value } = message; void type; void sessionId; void _instance; pendingSelection.current = value; setSelection(value); }
      else if (message.type === "CANVAS_ELEMENT_CLEARED") { pendingSelection.current = null; setSelection(null); }
      else if (message.type === "CANVAS_ROUTE_CHANGED") {
        if (message.pageId !== currentPageId) { pendingSelection.current = null; setSelection(null); }
        setRoute(message.route);
        const page = message.pageId;
        const url = new URL(window.location.href);
        if (page) url.searchParams.set("page", page); else url.searchParams.delete("page");
        window.history.replaceState(window.history.state, "", url);
      }
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [currentPageId, instanceId, post, selectMode, session.manifest.previewSessionId]);

  function send(message: ParentPreviewCommand) { post(message, session.manifest.previewSessionId, instanceId); }
  const navigate = useCallback((next: string) => {
    pendingSelection.current = null;
    setSelection(null);
    setRoute(next);
    post({ type: "CANVAS_NAVIGATE", route: next }, session.manifest.previewSessionId, instanceId);
  }, [instanceId, post, session.manifest.previewSessionId]);
  function changeTheme(mode: "light" | "dark") { dispatchView({ type: "SET_THEME", theme: mode }); send({ type: "CANVAS_SET_THEME", mode }); }
  function toggleSelectMode() { const next = !selectMode; setSelectMode(next); send({ type: "CANVAS_SET_SELECT_MODE", enabled: next }); if (!next) clearSelection(); }
  function clearSelection() { pendingSelection.current = null; setSelection(null); send({ type: "CANVAS_CLEAR_SELECTION" }); }

  const refresh = useCallback(async () => {
    setStatus("loading"); setError(undefined);
    try {
      const response = await fetch(`/api/projects/${projectId}/preview-session`, { method: "POST" });
      const value = await response.json() as PreviewSession & { error?: string };
      if (!response.ok) throw new Error(value.error || "Preview could not be prepared.");
      const retained = value.manifest.routes[route] ? route : initialPreviewRoute(value.manifest, currentPageId);
      const nextInstance = crypto.randomUUID();
      setSession(value); setRoute(retained); setInstanceId(nextInstance); setFrameSrc(makeSrc(value.token, retained, view.theme, nextInstance));
    } catch (cause) { setStatus("error"); setError(cause instanceof Error ? cause.message : "Preview could not be prepared."); }
  }, [currentPageId, makeSrc, projectId, route, view.theme]);

  const historyTarget = useMemo(
    () => (currentPageId ? { kind: "page" as const, id: currentPageId, name: currentPage?.name } : null),
    [currentPageId, currentPage?.name],
  );
  const onHistoryChanged = useCallback(() => { void refresh(); router.refresh(); }, [refresh, router]);

  /* -------------------------------------------------------------- agent */
  // Selecting inside a shared Building Block retargets the composer at that
  // block, so a global component is edited once instead of copied per page.
  const target: ComposerTarget | null = selection?.blockId
    ? { kind: "block", id: selection.blockId, name: session.manifest.blocks[selection.blockId]?.name ?? "Shared block" }
    : currentPageId ? { kind: "page", id: currentPageId } : null;
  const targetKey = target ? `${target.kind}:${target.id}` : null;
  const stateUrl = target ? (target.kind === "block" ? `/api/projects/${projectId}/blocks/${target.id}/ai` : `/api/projects/${projectId}/pages/${target.id}/ai`) : null;

  const loadAgentState = useCallback(async (url: string) => {
    const response = await fetch(url, { cache: "no-store" });
    const value = await response.json() as AgentState & { error?: string };
    if (!response.ok) throw new Error(value.error || "This conversation could not be loaded.");
    setAgentState(value);
    return value;
  }, []);

  useEffect(() => {
    if (!stateUrl) return;
    let active = true;
    const timer = window.setTimeout(() => {
      if (active) { setAgentState(null); setAgentError(undefined); setPrompt(""); setSelectedMediaIds([]); setAgentLoading(true); }
      void loadAgentState(stateUrl)
        .catch((cause: unknown) => { if (active) setAgentError(cause instanceof Error ? cause.message : "This conversation could not be loaded."); })
        .finally(() => { if (active) setAgentLoading(false); });
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [loadAgentState, stateUrl, targetKey]);

  const activeJob = agentState?.job && ACTIVE_JOB_STATUSES.has(agentState.job.status) ? agentState.job : null;
  useEffect(() => {
    if (!stateUrl || !activeJob) return;
    const timer = window.setInterval(() => { void loadAgentState(stateUrl).catch(() => undefined); }, 1_500);
    return () => window.clearInterval(timer);
  }, [activeJob, loadAgentState, stateUrl]);
  useEffect(() => {
    const job = agentState?.job;
    if (!job || job.status !== "completed" || completedRefresh.current === job.id) return;
    completedRefresh.current = job.id;
    setPrompt(""); setSelectedMediaIds([]);
    void refresh();
    router.refresh();
  }, [agentState?.job, refresh, router]);

  async function submitPrompt() {
    if (!target || !stateUrl || !prompt.trim() || activeJob) return;
    setAgentLoading(true); setAgentError(undefined);
    try {
      const body = { content: prompt, selectedMediaIds, selection: selection ? { canvasId: selection.canvasId, blockId: selection.blockId, usageKey: selection.usageKey } : null };
      const response = await fetch(stateUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const value = await response.json() as { error?: string };
      if (!response.ok) throw new Error(value.error || "The agent could not start this update.");
      await loadAgentState(stateUrl);
    } catch (cause) { setAgentError(cause instanceof Error ? cause.message : "The agent could not start this update."); }
    finally { setAgentLoading(false); }
  }
  async function cancelJob() {
    if (!activeJob || !stateUrl) return;
    setAgentLoading(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/generation-jobs/${activeJob.id}`, { method: "DELETE" });
      const value = await response.json() as { error?: string };
      if (!response.ok) throw new Error(value.error || "This update could not be cancelled.");
      await loadAgentState(stateUrl);
    } catch (cause) { setAgentError(cause instanceof Error ? cause.message : "This update could not be cancelled."); }
    finally { setAgentLoading(false); }
  }

  /* -------------------------------------------------------------- panels */
  const panelIsOpen = pathname.includes("/panel/");
  const openPanel = useCallback((name: string) => {
    const url = `/projects/${projectId}/panel/${name}`;
    // Swapping tools replaces the entry, so Escape/back from any panel returns
    // to the website instead of walking back through the tools you opened.
    if (panelIsOpen) router.replace(url); else router.push(url);
  }, [panelIsOpen, projectId, router]);

  const routesByPageId = useMemo(() => Object.fromEntries(session.manifest.pages.map((page) => [page.pageId, page.canonicalRoute])), [session.manifest.pages]);
  const selectPage = useCallback((pageId: string, pageRoute: string | undefined) => {
    if (pageRoute) navigate(pageRoute);
    else router.refresh(); // a brand-new page is not in the current manifest yet
    void pageId;
  }, [navigate, router]);

  const runPageAction = useCallback((values: Record<string, string>) => {
    const data = new FormData();
    data.set("projectId", projectId);
    for (const [key, value] of Object.entries(values)) data.set(key, value);
    void pageTreeAction({}, data).then(() => router.refresh());
  }, [projectId, router]);

  /* ---------------------------------------------------------- shortcuts */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && view.fullScreen) { dispatchView({ type: "EXIT_FULL_SCREEN" }); return; }
      const meta = event.metaKey || event.ctrlKey;
      if (!meta) return;
      const key = event.key.toLowerCase();
      if (key === "b") { event.preventDefault(); toggleExplorer(); }
      else if (key === "j") { event.preventDefault(); toggleAgent(); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleAgent, toggleExplorer, view.fullScreen]);

  /* --------------------------------------------------------- menu model */
  const key = modifier();
  const pageEntries: MenuEntry[] = currentNode ? [
    { kind: "separator" },
    { kind: "caption", label: currentNode.name },
    { kind: "item", label: "Page settings & address…", icon: <FileCog size={14} />, onSelect: () => openPanel("pages") },
    { kind: "item", label: "Duplicate this page", icon: <Copy size={14} />, onSelect: () => runPageAction({ intent: "duplicate", nodeId: currentNode.id }) },
    ...(currentNode.isHomepage ? [] : [{ kind: "item" as const, label: "Set as home page", icon: <House size={14} />, onSelect: () => runPageAction({ intent: "homepage", nodeId: currentNode.id }) }]),
  ] : [];

  const groups: MenuGroup[] = [
    { id: "canvas", label: "Canvas", entries: [
      { kind: "item", label: "All projects", icon: <LayoutGrid size={14} />, href: "/dashboard" },
      { kind: "item", label: "Workspaces", icon: <LayoutGrid size={14} />, href: "/workspaces" },
      { kind: "item", label: "Your account", icon: <UserRound size={14} />, href: "/account" },
      { kind: "separator" },
      { kind: "item", label: "Keyboard shortcuts", icon: <Keyboard size={14} />, onSelect: () => openPanel("shortcuts") },
      { kind: "separator" },
      { kind: "item", label: "Sign out", icon: <LogOut size={14} />, onSelect: () => startTransition(() => { void signOutAction(); }) },
    ] },
    { id: "project", label: "Project", entries: [
      { kind: "item", label: "Project details…", icon: <Settings size={14} />, onSelect: () => openPanel("overview") },
      { kind: "item", label: "Project settings…", icon: <Sparkles size={14} />, title: "Persistent guidance for the agent", onSelect: () => openPanel("settings") },
      { kind: "item", label: "Collaborators…", icon: <UsersRound size={14} />, onSelect: () => openPanel("collaborators") },
      { kind: "separator" },
      { kind: "item", label: "Export website…", icon: <Download size={14} />, onSelect: () => openPanel("export") },
    ] },
    { id: "pages", label: "Pages", entries: [
      { kind: "item", label: "Manage all pages…", icon: <ListTree size={14} />, onSelect: () => openPanel("pages") },
      { kind: "item", label: "New page", icon: <FilePlus2 size={14} />, onSelect: () => { saveLayout({ ...layout, explorer: true }); openPanel("pages"); } },
      { kind: "item", label: "New folder", icon: <FolderPlus size={14} />, onSelect: () => { saveLayout({ ...layout, explorer: true }); openPanel("pages"); } },
      ...pageEntries,
    ] },
    { id: "assets", label: "Assets", entries: [
      { kind: "item", label: "Images…", icon: <Images size={14} />, onSelect: () => openPanel("media") },
      { kind: "item", label: "Reusable sections…", icon: <Blocks size={14} />, title: "Building Blocks — navbars, footers and other shared sections", onSelect: () => openPanel("blocks") },
    ] },
    { id: "design", label: "Design", entries: [
      { kind: "item", label: "Brand & logo…", icon: <Palette size={14} />, onSelect: () => openPanel("brand") },
      { kind: "item", label: "Colours, type & spacing…", icon: <Type size={14} />, onSelect: () => openPanel("brand") },
      { kind: "separator" },
      { kind: "caption", label: "Preview appearance" },
      { kind: "item", label: "Light", icon: <Sun size={14} />, checked: view.theme === "light", onSelect: () => changeTheme("light") },
      { kind: "item", label: "Dark", icon: <Moon size={14} />, checked: view.theme === "dark", onSelect: () => changeTheme("dark") },
    ] },
    { id: "history", label: "History", entries: [
      { kind: "item", label: history?.canUndo ? history.undoLabel : "Nothing to undo", icon: <Undo2 size={14} />, disabled: !history?.canUndo, onSelect: () => history?.undo() },
      { kind: "item", label: history?.canRedo ? history.redoLabel : "Nothing to redo", icon: <Redo2 size={14} />, disabled: !history?.canRedo, onSelect: () => history?.redo() },
      { kind: "separator" },
      { kind: "item", label: "Version history…", icon: <RefreshCw size={14} />, onSelect: () => history?.openVersions() },
      { kind: "item", label: "Checkpoints…", icon: <Save size={14} />, title: "Save the whole website so you can come back to it", onSelect: () => history?.openCheckpoints() },
    ] },
    { id: "view", label: "View", entries: [
      { kind: "item", label: "Website explorer", icon: <PanelLeft size={14} />, keys: `${key}B`, checked: layout.explorer, onSelect: toggleExplorer },
      { kind: "item", label: "Website Agent", icon: <PanelRight size={14} />, keys: `${key}J`, checked: layout.agent, onSelect: toggleAgent },
      { kind: "separator" },
      { kind: "caption", label: "Preview size" },
      { kind: "item", label: "Desktop", icon: <Monitor size={14} />, checked: view.device === "desktop", onSelect: () => dispatchView({ type: "SET_DEVICE", device: "desktop" }) },
      { kind: "item", label: "Tablet", icon: <Tablet size={14} />, checked: view.device === "tablet", onSelect: () => dispatchView({ type: "SET_DEVICE", device: "tablet" }) },
      { kind: "item", label: "Phone", icon: <Smartphone size={14} />, checked: view.device === "mobile", onSelect: () => dispatchView({ type: "SET_DEVICE", device: "mobile" }) },
      { kind: "separator" },
      { kind: "item", label: "Full screen", icon: <Maximize2 size={14} />, keys: "Esc to exit", checked: view.fullScreen, onSelect: () => dispatchView({ type: "TOGGLE_FULL_SCREEN" }) },
      { kind: "item", label: "Refresh the preview", icon: <RefreshCw size={14} />, onSelect: () => void refresh() },
    ] },
  ];

  const built = target?.kind === "block" || currentPage?.contentStatus === "generated";
  const agentTarget: AgentTarget = target
    ? target.kind === "block" ? { kind: "block", id: target.id, name: target.name } : { kind: "page", id: target.id, name: currentPage?.name ?? "this page" }
    : null;

  return <div
    className="ws-shell"
    data-explorer={layout.explorer ? "on" : "off"}
    data-agent={layout.agent ? "on" : "off"}
    data-fullscreen={view.fullScreen ? "on" : "off"}
    data-resizing={resizing ? "on" : "off"}
    style={{ ["--ws-explorer-w" as string]: `${layout.explorerWidth}px`, ["--ws-ai-w" as string]: `${layout.agentWidth}px` }}
  >
    <header className="ws-menubar">
      <Link href="/dashboard" className="ws-mark" title="All projects" aria-label="All projects">C</Link>
      <MenuBar groups={groups} />
      <p className="ws-titlebar">
        <span className={`ws-dot ${activeJob ? "ws-dot-busy" : ""}`} aria-hidden="true" />
        <strong>{projectName}</strong>
        <span className="ws-titlebar-note">{activeJob ? "The agent is working…" : projectStatus === "active" ? "All changes saved" : projectStatus}</span>
      </p>
      <div className="ws-menubar-right">
        {canManageProject ? <button type="button" className="ws-menu-trigger" onClick={() => openPanel("collaborators")}>Share</button> : null}
        <button type="button" className="ws-avatar" title={userName} aria-label={`Your account — ${userName}`} onClick={() => openPanel("overview")}>{initials(userName)}</button>
      </div>
    </header>

    <div className="ws-body">
      <aside className="ws-pane ws-pane-l" aria-label="Website structure">
        <Explorer
          projectId={projectId}
          nodes={nodes}
          currentPageId={currentPageId}
          routes={routesByPageId}
          onSelectPage={selectPage}
          onEditWithAgent={(pageId, pageRoute) => { selectPage(pageId, pageRoute); if (!layout.agent) toggleAgent(); }}
          onOpenPagesPanel={() => openPanel("pages")}
        />
        <button type="button" className="ws-resize ws-resize-r" aria-label="Resize the explorer" onPointerDown={() => setResizing("explorer")} />
      </aside>

      <PreviewStage
        frame={frame}
        frameSrc={frameSrc}
        sandboxTitle={`${session.manifest.brand.companyName} website preview`}
        device={view.device as Device}
        route={route}
        host={hostLabel(session.manifest.brand.companyName)}
        status={status}
        error={error}
        selectMode={selectMode}
        fullScreen={view.fullScreen}
        onDevice={(device) => dispatchView({ type: "SET_DEVICE", device })}
        onSelectMode={toggleSelectMode}
        onRefresh={() => void refresh()}
        onFullScreen={() => dispatchView({ type: "TOGGLE_FULL_SCREEN" })}
      />

      <aside className="ws-pane ws-pane-r" aria-label="Website Agent">
        <button type="button" className="ws-resize ws-resize-l" aria-label="Resize the agent panel" onPointerDown={() => setResizing("agent")} />
        <AgentPanel
          target={agentTarget}
          selection={selection}
          selectMode={selectMode}
          messages={agentState?.messages ?? null}
          job={agentState?.job ?? null}
          activeJob={activeJob}
          loading={agentLoading}
          error={agentError}
          prompt={prompt}
          selectedMediaIds={selectedMediaIds}
          assets={mediaAssets}
          folders={mediaFolders}
          built={Boolean(built)}
          onPrompt={setPrompt}
          onMedia={setSelectedMediaIds}
          onClearSelection={clearSelection}
          onSubmit={() => void submitPrompt()}
          onCancel={() => void cancelJob()}
          onHide={toggleAgent}
          onOpenHistory={() => history?.openVersions()}
        />
      </aside>
    </div>

    <footer className="ws-statusbar">
      <button type="button" className="ws-sb-btn" aria-pressed={layout.explorer} title={`Show or hide the website explorer (${key}B)`} onClick={toggleExplorer}><PanelLeft size={12} aria-hidden="true" /><span className="ws-desktop-only">Explorer</span></button>
      <button type="button" className="ws-sb-btn" aria-pressed={layout.agent} title={`Show or hide the Website Agent (${key}J)`} onClick={toggleAgent}><PanelRight size={12} aria-hidden="true" /><span className="ws-desktop-only">Agent</span></button>
      <span className="ws-sb-sep" />
      <button type="button" className="ws-sb-btn" disabled={!history?.canUndo} title={history?.undoLabel} onClick={() => history?.undo()}><Undo2 size={12} aria-hidden="true" />Undo</button>
      <button type="button" className="ws-sb-btn" disabled={!history?.canRedo} title={history?.redoLabel} onClick={() => history?.redo()}><Redo2 size={12} aria-hidden="true" />Redo</button>
      <span className="ws-sb-sep" />
      <button type="button" className="ws-sb-btn" onClick={() => history?.openVersions()}>History</button>
      <span className="ws-sb-spacer" />
      {status === "error"
        ? <span className="ws-sb-note ws-sb-bad" role="status">Preview error</span>
        : status === "loading"
          ? <span className="ws-sb-note" role="status">Loading preview…</span>
          : <span className="ws-sb-note ws-sb-ok" role="status">Preview ready</span>}
      <span className="ws-sb-sep" />
      <span className="ws-sb-note">{currentPage?.name ?? "No page"}</span>
    </footer>

    {/* Mounted for its logic and its History dialog; the visible controls live
        in the status bar and the History menu. */}
    <HistoryControls
      projectId={projectId}
      target={historyTarget}
      onChanged={onHistoryChanged}
      showCheckpoints
      hideTrigger
      onApi={publishHistoryApi}
    />
  </div>;
}

/** Two published History APIs are interchangeable when everything the chrome
 *  renders from them matches and the callbacks are the same functions. */
function sameHistory(a: HistoryApi, b: HistoryApi) {
  return a.canUndo === b.canUndo
    && a.canRedo === b.canRedo
    && a.undoLabel === b.undoLabel
    && a.redoLabel === b.redoLabel
    && a.busy === b.busy
    && a.undo === b.undo
    && a.redo === b.redo
    && a.openVersions === b.openVersions
    && a.openCheckpoints === b.openCheckpoints;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

/** A friendly stand-in for the site's own domain in the address bar. */
function hostLabel(companyName: string) {
  const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug ? `${slug}.site` : "your-website.site";
}
