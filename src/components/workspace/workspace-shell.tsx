"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Bot, CircleAlert, CircleCheck, FileText, LoaderCircle, Save, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useTransition } from "react";
import { signOutAction } from "@/app/actions/auth";
import { shouldSuggestCheckpoint, useHistoryController } from "@/components/history/use-history-controller";
import type { HistorySection } from "@/components/history/history-sidebar";
import { ChangeReview } from "@/components/history/change-review";
import { AddSectionDialog } from "@/components/blocks/add-section-dialog";
import { CommandPalette } from "@/components/commands/command-palette";
import { TaskCenter } from "@/components/tasks/task-center";
import { createWorkspaceCommands } from "@/domain/commands/registry";
import type { CommandPage } from "@/domain/commands/types";
import type { ProjectTask } from "@/domain/tasks/model";
import { AgentPanel, type AgentMessage, type AgentJob, type AgentTarget, type AgentQueueItem } from "./agent-panel";
import { ActivityBar } from "./activity-bar";
import { ContextSidebar } from "./context-sidebar";
import { Explorer } from "./explorer";
import { notePanelPushed, panelHref } from "./panel-url";
import { PreviewStage, type Device } from "./preview-stage";
import { TitleBar } from "./title-bar";
import { AGENT_PANE_RANGE, breakpointFor, DEFAULT_WORKSPACE_LAYOUT, normalizeWorkspaceLayout, PRIMARY_PANE_RANGE, type WorkspaceBreakpoint, type WorkspaceLayout, type WorkspaceActivity } from "./workspace-layout";
import { isActiveJobStatus, isWorking, workLabel, workPhase } from "./work-state";
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

const PRIMARY_RANGE = PRIMARY_PANE_RANGE;
const AGENT_RANGE = AGENT_PANE_RANGE;

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
  projectId, workspaceName, projectName, projectStatus, userId, userName, initialSession, initialPageId, initialInstanceId, nodes, mediaAssets, mediaFolders, canManageProject,
}: {
  projectId: string;
  workspaceName: string;
  projectName: string;
  projectStatus: string;
  userId: string;
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
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const frame = useRef<HTMLIFrameElement>(null);
  const initialRoute = initialPreviewRoute(initialSession.manifest, initialPageId);

  const [session, setSession] = useState(initialSession);
  const [instanceId, setInstanceId] = useState(initialInstanceId);
  const [route, setRoute] = useState(initialRoute);
  const [routeHistory, setRouteHistory] = useState({ entries: [initialRoute], index: 0 });
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
  const [queuedFollowUps, setQueuedFollowUps] = useState<AgentQueueItem[]>([]);
  const [agentError, setAgentError] = useState<string>();
  const [breakpoint, setBreakpoint] = useState<WorkspaceBreakpoint>("desktop");
  const [layout, setLayout] = useState<WorkspaceLayout>(DEFAULT_WORKSPACE_LAYOUT);
  const [createRequest, setCreateRequest] = useState<{ type: "page" | "folder"; key: number } | null>(null);
  const createKey = useRef(0);
  const [historySection, setHistorySection] = useState<HistorySection>(null);
  const [checkpointNudgeFrom, setCheckpointNudgeFrom] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [taskCenterOpen, setTaskCenterOpen] = useState(false);
  const [reviewJobId, setReviewJobId] = useState<string | null>(null);
  const [addSectionOpen, setAddSectionOpen] = useState(false);
  const [sectionBusy, setSectionBusy] = useState(false);
  const [sectionError, setSectionError] = useState<string>();
  const [taskSummary, setTaskSummary] = useState<ProjectTask[]>([]);
  const completedRefresh = useRef<string | null>(null);
  const pendingSelection = useRef<ElementSelection | null>(null);

  const currentPageId = session.manifest.routes[route]?.pageId ?? null;
  const currentPage = session.manifest.pages.find((page) => page.pageId === currentPageId) ?? null;

  /* ------------------------------------------------------------- layout */
  const layoutKey = `canvas.workspace.layout.${userId}.${projectId}`;
  useEffect(() => {
    function read() { const nextBreakpoint = breakpointFor(window.innerWidth); setBreakpoint(nextBreakpoint); setLayout((current) => { try { const stored = window.localStorage.getItem(layoutKey); return normalizeWorkspaceLayout(stored ? JSON.parse(stored) as Partial<WorkspaceLayout> : current, nextBreakpoint); } catch { return normalizeWorkspaceLayout(current, nextBreakpoint); } }); }
    const timer = window.setTimeout(read, 0); window.addEventListener("resize", read); return () => { clearTimeout(timer); window.removeEventListener("resize", read); };
  }, [layoutKey]);

  // Mirrors the layout so the drag handlers can persist the final width without
  // depending on a stale closure.
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const persistLayout = useCallback((next: WorkspaceLayout) => { try { window.localStorage.setItem(layoutKey, JSON.stringify(next)); } catch { /* convenience only */ } }, [layoutKey]);
  const saveLayout = useCallback((input: WorkspaceLayout) => { const next = normalizeWorkspaceLayout(input, breakpoint); setLayout(next); persistLayout(next); }, [breakpoint, persistLayout]);
  const showMobileSurface = useCallback((surface: "tools" | "preview" | "agent") => saveLayout({ ...layout, mobileSurface: surface, primary: surface === "tools", agent: surface === "agent" }), [layout, saveLayout]);
  const toggleExplorer = useCallback(() => { if (breakpoint === "mobile") { showMobileSurface(layout.mobileSurface === "tools" ? "preview" : "tools"); return; } saveLayout({ ...layout, primary: !layout.primary, ...(breakpoint === "compact" && !layout.primary ? { agent: false } : {}) }); }, [breakpoint, layout, saveLayout, showMobileSurface]);
  const toggleAgent = useCallback(() => { if (breakpoint === "mobile") { showMobileSurface(layout.mobileSurface === "agent" ? "preview" : "agent"); return; } const opening = !layout.agent; saveLayout({ ...layout, agent: opening, ...(breakpoint === "compact" && opening ? { primary: false } : {}) }); }, [breakpoint, layout, saveLayout, showMobileSurface]);
  const selectActivity = useCallback((activity: WorkspaceActivity) => { if (breakpoint === "mobile") { saveLayout({ ...layout, activity, mobileSurface: "tools", primary: true, agent: false }); return; } if (layout.activity === activity && layout.primary) saveLayout({ ...layout, primary: false }); else saveLayout({ ...layout, activity, primary: true, ...(breakpoint === "compact" ? { agent: false } : {}) }); }, [breakpoint, layout, saveLayout]);
  const requestCreate = useCallback((type: "page" | "folder") => { selectActivity("website"); createKey.current += 1; setCreateRequest({ type, key: createKey.current }); }, [selectActivity]);

  const [resizing, setResizing] = useState<"explorer" | "agent" | null>(null);

  /**
   * Keyboard resizing, and the semantics that make the handle mean something.
   *
   * The two drag strips were tab stops that did nothing without a pointer and
   * reported no role, no orientation and no value. They are window splitters:
   * arrows move them a step, Home and End take them to their limits.
   */
  const nudgePane = useCallback((pane: "explorer" | "agent", delta: number | "min" | "max") => {
    const range = pane === "explorer" ? PRIMARY_RANGE : AGENT_RANGE;
    const key = pane === "explorer" ? "primaryWidth" : "agentWidth";
    const current = layoutRef.current[key];
    const next = delta === "min" ? range[0] : delta === "max" ? range[1] : Math.min(range[1], Math.max(range[0], current + delta));
    if (next === current) return;
    saveLayout({ ...layoutRef.current, [key]: next });
  }, [saveLayout]);
  const resizeKeys = useCallback((pane: "explorer" | "agent") => (event: React.KeyboardEvent) => {
    // The explorer grows to the right and the agent grows to the left, so the
    // same arrow key has to mean "wider" on one and "narrower" on the other.
    const direction = pane === "explorer" ? 1 : -1;
    const step = event.shiftKey ? 48 : 16;
    if (event.key === "ArrowRight") { event.preventDefault(); nudgePane(pane, step * direction); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); nudgePane(pane, -step * direction); }
    else if (event.key === "Home") { event.preventDefault(); nudgePane(pane, "min"); }
    else if (event.key === "End") { event.preventDefault(); nudgePane(pane, "max"); }
  }, [nudgePane]);

  useEffect(() => {
    if (!resizing) return;
    function onMove(event: PointerEvent) {
      if (resizing === "explorer") {
        const width = Math.min(PRIMARY_RANGE[1], Math.max(PRIMARY_RANGE[0], event.clientX - 48));
        setLayout((current) => ({ ...current, primaryWidth: width }));
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
  const recordRoute = useCallback((next: string) => { setRoute(next); setRouteHistory((current) => { if (current.entries[current.index] === next) return current; const entries = [...current.entries.slice(0, current.index + 1), next].slice(-30); return { entries, index: entries.length - 1 }; }); }, []);

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
        recordRoute(message.route);
        const page = message.pageId;
        const url = new URL(window.location.href);
        if (page) url.searchParams.set("page", page); else url.searchParams.delete("page");
        window.history.replaceState(window.history.state, "", url);
      }
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [currentPageId, instanceId, post, recordRoute, selectMode, session.manifest.previewSessionId]);

  /*
   * Preview readiness, honestly.
   *
   * The handshake from inside the frame is the real signal, but it can be
   * missed — a tool panel opening over the workspace was enough — and the
   * status bar then sat at "Loading preview…" over a website that had been
   * painted for minutes. The frame's own load event is the backstop: if the
   * document loaded and no handshake followed, the preview is up, and saying so
   * is closer to the truth than a spinner that never stops.
   */
  const readyFallback = useRef<number>(undefined);
  const onFrameLoad = useCallback(() => {
    window.clearTimeout(readyFallback.current);
    readyFallback.current = window.setTimeout(() => setStatus((current) => (current === "loading" ? "ready" : current)), 2_000);
  }, []);
  useEffect(() => () => window.clearTimeout(readyFallback.current), []);

  function send(message: ParentPreviewCommand) { post(message, session.manifest.previewSessionId, instanceId); }
  const navigate = useCallback((next: string) => {
    pendingSelection.current = null;
    setSelection(null);
    recordRoute(next);
    post({ type: "CANVAS_NAVIGATE", route: next }, session.manifest.previewSessionId, instanceId);
  }, [instanceId, post, recordRoute, session.manifest.previewSessionId]);
  const stepPreviewHistory = useCallback((delta: -1 | 1) => { const index = routeHistory.index + delta; const next = routeHistory.entries[index]; if (!next || index < 0 || index >= routeHistory.entries.length) return; pendingSelection.current = null; setSelection(null); setRoute(next); setRouteHistory({ ...routeHistory, index }); post({ type: "CANVAS_NAVIGATE", route: next }, session.manifest.previewSessionId, instanceId); }, [instanceId, post, routeHistory, session.manifest.previewSessionId]);
  const changeTheme = useCallback((mode: "light" | "dark") => { dispatchView({ type: "SET_THEME", theme: mode }); post({ type: "CANVAS_SET_THEME", mode }, session.manifest.previewSessionId, instanceId); }, [instanceId, post, session.manifest.previewSessionId]);
  function toggleSelectMode() { const next = !selectMode; setSelectMode(next); send({ type: "CANVAS_SET_SELECT_MODE", enabled: next }); if (!next) clearSelection(); }
  function clearSelection() { pendingSelection.current = null; setSelection(null); send({ type: "CANVAS_CLEAR_SELECTION" }); }

  /**
   * Mints a new preview session and reloads the frame from it.
   *
   * `openPageId` lands the frame directly on that page rather than posting a
   * navigation afterwards, which would race the new frame's load. It is how a
   * page that did not exist a moment ago becomes the one you are editing.
   */
  const refresh = useCallback(async (openPageId?: string) => {
    setStatus("loading"); setError(undefined);
    try {
      const response = await fetch(`/api/projects/${projectId}/preview-session`, { method: "POST" });
      const value = await response.json() as PreviewSession & { error?: string };
      if (!response.ok) throw new Error(value.error || "Preview could not be prepared.");
      const opened = openPageId ? value.manifest.pages.find((page) => page.pageId === openPageId) : null;
      const retained = opened?.canonicalRoute ?? (value.manifest.routes[route] ? route : initialPreviewRoute(value.manifest, currentPageId));
      const nextInstance = crypto.randomUUID();
      pendingSelection.current = null;
      setSelection(null);
      setSession(value); recordRoute(retained); setInstanceId(nextInstance); setFrameSrc(makeSrc(value.token, retained, view.theme, nextInstance));
    } catch (cause) { setStatus("error"); setError(cause instanceof Error ? cause.message : "Preview could not be prepared."); }
  }, [currentPageId, makeSrc, projectId, recordRoute, route, view.theme]);

  /*
   * The preview manifest is a snapshot taken when the session was minted, so it
   * does not learn about a new, renamed or deleted page on its own — which is
   * why creating a page used to need a full browser reload before it could be
   * opened. `nodes` is a live prop, so whenever the tree really changes, mint a
   * fresh session to match it. This covers every route that edits pages: the
   * explorer, the Pages panel, and anything added later.
   */
  const treeSignature = useMemo(
    () => nodes.map((node) => `${node.id}:${node.name}:${node.routePath ?? ""}:${node.parentId ?? ""}:${node.position}:${node.isHomepage}`).join("|"),
    [nodes],
  );
  const syncedSignature = useRef(treeSignature);
  const pendingOpen = useRef<string | null>(null);
  useEffect(() => {
    if (syncedSignature.current === treeSignature) return;
    syncedSignature.current = treeSignature;
    const open = pendingOpen.current;
    pendingOpen.current = null;
    void refresh(open ?? undefined);
  }, [refresh, treeSignature]);

  /** Called by the explorer after it changes the tree. */
  const onTreeChanged = useCallback((createdNodeId?: string) => {
    // Remembered across the refresh so the new page is the one that opens.
    pendingOpen.current = createdNodeId ?? null;
    router.refresh();
  }, [router]);

  const historyTarget = useMemo(
    () => (currentPageId ? { kind: "page" as const, id: currentPageId, name: currentPage?.name } : null),
    [currentPageId, currentPage?.name],
  );
  const onHistoryChanged = useCallback(() => { void refresh(); router.refresh(); }, [refresh, router]);

  /* ----------------------------------------------------------- sections */
  /*
   * A selected element that belongs to a shared Building Block is a *usage* of that
   * block on this page. "Remove from page" therefore removes the reference — the
   * `<CanvasBlock />` in this page's source and the usage row that mirrors it — and
   * leaves the section itself in the library for every other page that uses it.
   */
  const selectedSectionUsage = useMemo(() => (selection?.blockId && selection.usageKey && currentPageId
    ? { blockId: selection.blockId, usageKey: selection.usageKey, name: session.manifest.blocks[selection.blockId]?.name ?? "this section" }
    : null), [currentPageId, selection?.blockId, selection?.usageKey, session.manifest.blocks]);

  const removeSelectedSection = useCallback(async () => {
    if (!selectedSectionUsage || !currentPageId) return;
    setSectionBusy(true); setSectionError(undefined);
    try {
      const response = await fetch(`/api/projects/${projectId}/pages/${currentPageId}/sections/${encodeURIComponent(selectedSectionUsage.usageKey)}`, { method: "DELETE" });
      const value = await response.json() as { error?: string };
      if (!response.ok) throw new Error(value.error || "That section could not be removed from this page.");
      pendingSelection.current = null;
      setSelection(null);
      // A new Page Version is active, so the manifest the frame is running against is
      // now stale: minting a fresh session is what makes the section actually go away.
      await refresh();
      router.refresh();
    } catch (cause) { setSectionError(cause instanceof Error ? cause.message : "That section could not be removed from this page."); }
    finally { setSectionBusy(false); }
  }, [currentPageId, projectId, refresh, router, selectedSectionUsage]);

  const onSectionAdded = useCallback(() => { void refresh(); router.refresh(); }, [refresh, router]);
  const history = useHistoryController({ projectId, target: historyTarget, onChanged: onHistoryChanged, withCheckpoints: true });

  // Opening History means opening the sidebar section, not a dialog. The
  // shortcuts, the command palette and the agent's "see history" link all land
  // in the same place the sidebar shows.
  const openHistorySection = useCallback((section: Exclude<HistorySection, null>) => {
    setHistorySection(section);
    selectActivity("history");
  }, [selectActivity]);
  const openVersions = useCallback(() => openHistorySection("versions"), [openHistorySection]);
  const openCheckpoints = useCallback(() => openHistorySection("checkpoints"), [openHistorySection]);

  /* -------------------------------------------------------------- agent */
  // Selecting inside a shared Building Block retargets the composer at that
  // block, so a global component is edited once instead of copied per page.
  const target: ComposerTarget | null = useMemo(() => selection?.blockId
    ? { kind: "block", id: selection.blockId, name: session.manifest.blocks[selection.blockId]?.name ?? "Shared block" }
    : currentPageId ? { kind: "page", id: currentPageId } : null, [currentPageId, selection?.blockId, session.manifest.blocks]);
  const targetKey = target ? `${target.kind}:${target.id}` : null;
  const stateUrl = target ? (target.kind === "block" ? `/api/projects/${projectId}/blocks/${target.id}/ai` : `/api/projects/${projectId}/pages/${target.id}/ai`) : null;

  const loadAgentState = useCallback(async (url: string) => {
    const response = await fetch(url, { cache: "no-store" });
    const value = await response.json() as AgentState & { error?: string };
    if (!response.ok) throw new Error(value.error || "This conversation could not be loaded.");
    setAgentState(value);
    return value;
  }, []);
  const loadQueue = useCallback(async (nextTarget: ComposerTarget) => { const type = nextTarget.kind === "block" ? "building_block" : "page"; const response = await fetch(`/api/projects/${projectId}/ai-queue?targetType=${type}&targetId=${nextTarget.id}`, { cache: "no-store" }); const value = await response.json() as { items?: AgentQueueItem[] }; if (response.ok) setQueuedFollowUps(value.items ?? []); }, [projectId]);

  useEffect(() => {
    if (!stateUrl) return;
    let active = true;
    const timer = window.setTimeout(() => {
      if (active) { setAgentState(null); setAgentError(undefined); setPrompt(""); setSelectedMediaIds([]); setAgentLoading(true); }
      void Promise.all([loadAgentState(stateUrl), target ? loadQueue(target) : Promise.resolve()])
        .catch((cause: unknown) => { if (active) setAgentError(cause instanceof Error ? cause.message : "This conversation could not be loaded."); })
        .finally(() => { if (active) setAgentLoading(false); });
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [loadAgentState, loadQueue, stateUrl, target, targetKey]);

  const activeJob = agentState?.job && isActiveJobStatus(agentState.job.status) ? agentState.job : null;
  useEffect(() => {
    if (!stateUrl || !activeJob) return;
    const timer = window.setInterval(() => { void loadAgentState(stateUrl).catch(() => undefined); }, 1_500);
    return () => window.clearInterval(timer);
  }, [activeJob, loadAgentState, stateUrl]);
  useEffect(() => {
    const job = agentState?.job;
    if (!job || job.status !== "completed" || completedRefresh.current === job.id) return;
    completedRefresh.current = job.id;
    // The composer is cleared when a request is sent, not when it finishes:
    // clearing here threw away anything typed while the agent was working.
    // Finishing a generation is the moment a checkpoint is worth offering, so a
    // dismissal from before the job does not hide it again.
    setCheckpointNudgeFrom(0);
    void refresh();
    router.refresh();
  }, [agentState?.job, refresh, router]);

  async function submitPrompt() {
    if (!target || !stateUrl || !prompt.trim()) return;
    setAgentLoading(true); setAgentError(undefined);
    try {
      const body = { content: prompt, selectedMediaIds, selection: selection ? { canvasId: selection.canvasId, blockId: selection.blockId, usageKey: selection.usageKey } : null };
      const response = activeJob
        ? await fetch(`/api/projects/${projectId}/ai-queue`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetType: target.kind === "block" ? "building_block" : "page", targetId: target.id, prompt, selectedMediaIds, selection: body.selection }) })
        : await fetch(stateUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const value = await response.json() as { error?: string };
      if (!response.ok) throw new Error(value.error || "The agent could not start this update.");
      // Whatever was sent leaves the composer immediately. Leaving it in place
      // while the job ran read as a send that had failed, and pressing Enter
      // again queued the same request a second time.
      setPrompt(""); setSelectedMediaIds([]);
      if (activeJob) await loadQueue(target); else await loadAgentState(stateUrl);
    } catch (cause) { setAgentError(cause instanceof Error ? cause.message : "The agent could not start this update."); }
    finally { setAgentLoading(false); }
  }
  async function cancelQueued(id: string) { const response = await fetch(`/api/projects/${projectId}/ai-queue/${id}`, { method: "DELETE" }); if (!response.ok) { const value = await response.json() as { error?: string }; setAgentError(value.error || "This follow-up could not be cancelled."); } if (target) await loadQueue(target); }
  async function editQueued(item: AgentQueueItem, nextPrompt: string) { const response = await fetch(`/api/projects/${projectId}/ai-queue/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: nextPrompt, selectedMediaIds: item.selectedMediaIds, selection: item.selectedElement }) }); if (!response.ok) { const value = await response.json() as { error?: string }; setAgentError(value.error || "This follow-up could not be edited."); } if (target) await loadQueue(target); }
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
  // The open tool is a parameter on this same URL, never a route of its own —
  // see panel-url.ts. Reading it from the URL rather than from local state is
  // what makes a reload, a bookmark and a menu click indistinguishable.
  const panelIsOpen = Boolean(searchParams.get("tool"));
  const openPanel = useCallback((name: string, query?: Record<string, string>) => {
    // Built from the live location so the previewed page, and anything else the
    // workspace has written to the URL, survives opening a tool.
    const href = panelHref(new URL(window.location.href), name, query);
    // Swapping tools replaces the entry, so Escape/back from any panel returns
    // to the website instead of walking back through the tools you opened.
    if (panelIsOpen) router.replace(href, { scroll: false });
    else { notePanelPushed(); router.push(href, { scroll: false }); }
  }, [panelIsOpen, router]);

  const commands = useMemo(() => createWorkspaceCommands({
    canManageProject, hasPage: Boolean(currentPageId), hasSelection: Boolean(selection), activeWork: taskSummary.some((task) => task.status === "active"),
    canUndo: history.canUndo, canRedo: history.canRedo, explorerOpen: layout.primary, agentOpen: layout.agent,
    openPanel, openPalette: () => setPaletteOpen(true), openTasks: () => setTaskCenterOpen(true), openHistory: openVersions, openCheckpoints, navigate: (href) => router.push(href),
    openWebsite: () => selectActivity("website"), openAssets: () => selectActivity("assets"), openDesign: () => selectActivity("design"), openSections: () => selectActivity("sections"), newPage: () => requestCreate("page"), newFolder: () => requestCreate("folder"),
    toggleExplorer, toggleAgent, undo: history.undo, redo: history.redo, setTheme: changeTheme,
    setDevice: (device) => dispatchView({ type: "SET_DEVICE", device }), refreshPreview: () => void refresh(), toggleFullScreen: () => dispatchView({ type: "TOGGLE_FULL_SCREEN" }),
    signOut: () => startTransition(() => { void signOutAction(); }),
  }), [canManageProject, changeTheme, currentPageId, history, layout.agent, layout.primary, openCheckpoints, openPanel, openVersions, refresh, requestCreate, router, selectActivity, selection, startTransition, taskSummary, toggleAgent, toggleExplorer]);
  const commandPages = useMemo<CommandPage[]>(() => nodes.map((node) => ({ id: node.id, name: node.name, slug: node.slug, routePath: node.routePath, type: node.type })), [nodes]);

  const loadTaskSummary = useCallback(async () => { try { const response = await fetch(`/api/projects/${projectId}/tasks`, { cache: "no-store" }); if (response.ok) setTaskSummary(((await response.json()) as { tasks: ProjectTask[] }).tasks); } catch { /* detailed recovery lives in the task center */ } }, [projectId]);
  useEffect(() => { const timer = window.setTimeout(() => void loadTaskSummary(), 0); const interval = window.setInterval(() => void loadTaskSummary(), 3_000); return () => { clearTimeout(timer); clearInterval(interval); }; }, [loadTaskSummary]);

  const routesByPageId = useMemo(() => Object.fromEntries(session.manifest.pages.map((page) => [page.pageId, page.canonicalRoute])), [session.manifest.pages]);
  const selectPage = useCallback((pageId: string, pageRoute: string | undefined) => {
    // A page with no route yet means the manifest is behind the tree; minting a
    // session that includes it opens it rather than doing nothing.
    if (pageRoute) navigate(pageRoute); else void refresh(pageId);
  }, [navigate, refresh]);

  /* ---------------------------------------------------------- shortcuts */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && view.fullScreen) { dispatchView({ type: "EXIT_FULL_SCREEN" }); return; }
      // On a laptop the agent floats over the website. Escape closes it, the
      // same key that closes every other thing layered over the workspace.
      if (event.key === "Escape" && breakpoint === "compact" && layout.agent && !panelIsOpen && !paletteOpen && !taskCenterOpen && !reviewJobId) {
        const target = event.target as HTMLElement | null;
        if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
        toggleAgent();
        return;
      }
      const meta = event.metaKey || event.ctrlKey;
      if (!meta) return;
      const key = event.key.toLowerCase();
      if (key === "k") { event.preventDefault(); setPaletteOpen(true); }
      else if (key === "b") { event.preventDefault(); toggleExplorer(); }
      else if (key === "j") { event.preventDefault(); toggleAgent(); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [breakpoint, layout.agent, paletteOpen, panelIsOpen, reviewJobId, taskCenterOpen, toggleAgent, toggleExplorer, view.fullScreen]);

  /*
   * One answer to "what is happening right now", shared by the status bar, the
   * title bar, the preview and the agent. A job on another page still counts:
   * the footer saying "Website up to date" next to its own "1 active" button
   * was the contradiction this removes.
   */
  const otherWorkRunning = taskSummary.some((task) => task.status === "active");
  const phase = workPhase({ jobStatus: activeJob?.status ?? (otherWorkRunning ? "generating" : undefined), previewStatus: status });
  const phaseLabel = workLabel(phase);
  const working = isWorking(phase);

  const built = target?.kind === "block" || currentPage?.contentStatus === "generated";
  const showCheckpointNudge = shouldSuggestCheckpoint(history.pendingChanges, checkpointNudgeFrom);
  const agentTarget: AgentTarget = target
    ? target.kind === "block" ? { kind: "block", id: target.id, name: target.name } : { kind: "page", id: target.id, name: currentPage?.name ?? "this page" }
    : null;

  return <div
    className="ws-shell"
    data-primary={layout.primary ? "on" : "off"}
    data-agent={layout.agent ? "on" : "off"}
    data-breakpoint={breakpoint}
    data-surface={layout.mobileSurface}
    data-fullscreen={view.fullScreen ? "on" : "off"}
    data-resizing={resizing ? "on" : "off"}
    style={{ ["--ws-primary-w" as string]: `${layout.primaryWidth}px`, ["--ws-ai-w" as string]: `${layout.agentWidth}px` }}
  >
    {/* The workspace is one screen with several regions and no visible page
        title; this names it once for anyone navigating by heading. */}
    <h1 className="sr-only">{projectName} — website workspace</h1>
    <TitleBar workspaceName={workspaceName} projectName={projectName} pageName={currentPage?.name ?? "No page"} userName={userName} canShare={canManageProject} activeTasks={taskSummary.filter((task) => task.status === "active").length} failedTasks={taskSummary.filter((task) => task.status === "failed").length} saveState={working ? phaseLabel : projectStatus === "active" ? undefined : projectStatus} agentOpen={layout.agent} onSearch={() => setPaletteOpen(true)} onShare={() => openPanel("collaborators")} onTasks={() => setTaskCenterOpen(true)} onToggleAgent={toggleAgent} onSignOut={() => startTransition(() => { void signOutAction(); })} />

    <div className="ws-body">
      <ActivityBar activity={layout.activity} sidebarOpen={layout.primary} onActivity={selectActivity} onSettings={() => openPanel("overview")} onHelp={() => openPanel("shortcuts")} />
      <aside className="ws-pane ws-pane-l" aria-label={`${layout.activity} tools`}>
        <ContextSidebar projectId={projectId} activity={layout.activity} mediaAssets={mediaAssets} mediaFolders={mediaFolders} blocks={session.manifest.blocks} history={history} historySection={historySection} onOpenPanel={openPanel} onNewBlock={() => openPanel("blocks")} onAddSection={() => setAddSectionOpen(true)} canAddSection={Boolean(currentPageId)} onHistorySection={setHistorySection} website={<Explorer projectId={projectId} nodes={nodes} currentPageId={currentPageId} routes={routesByPageId} onSelectPage={selectPage} onEditWithAgent={(pageId, pageRoute) => { selectPage(pageId, pageRoute); if (!layout.agent) toggleAgent(); }} onOpenPagesPanel={(nodeId) => openPanel("pages", nodeId ? { node: nodeId } : undefined)} onTreeChanged={onTreeChanged} createRequest={createRequest} />} />
        <div
          className="ws-resize ws-resize-r"
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label="Resize the website sidebar"
          aria-valuenow={Math.round(layout.primaryWidth)}
          aria-valuemin={PRIMARY_RANGE[0]}
          aria-valuemax={PRIMARY_RANGE[1]}
          aria-valuetext={`${Math.round(layout.primaryWidth)} pixels wide`}
          onPointerDown={() => setResizing("explorer")}
          onKeyDown={resizeKeys("explorer")}
        />
      </aside>

      <PreviewStage
        frame={frame}
        frameSrc={frameSrc}
        sandboxTitle={`${session.manifest.brand.companyName} website preview`}
        device={view.device as Device}
        route={route}
        host={hostLabel(session.manifest.brand.companyName)}
        pages={session.manifest.pages.map((page) => ({ id: page.pageId, name: page.name, route: page.canonicalRoute }))}
        status={status}
        error={error}
        selectMode={selectMode}
        fullScreen={view.fullScreen}
        theme={view.theme}
        zoom={layout.zoom}
        fit={layout.fit}
        workLabel={phaseLabel}
        building={working && Boolean(activeJob) && target?.kind === "page" && !built}
        canBack={routeHistory.index > 0}
        canForward={routeHistory.index < routeHistory.entries.length - 1}
        onFrameLoad={onFrameLoad}
        empty={session.manifest.pages.length ? undefined : <>
          <h2>This website has no pages yet</h2>
          <p>Every website starts with a page. Create one, then describe what it should contain and the agent will build it.</p>
          <button type="button" className="button button-primary" onClick={() => requestCreate("page")}>Create your first page</button>
        </>}
        onBack={() => stepPreviewHistory(-1)}
        onForward={() => stepPreviewHistory(1)}
        onPage={navigate}
        onDevice={(device) => dispatchView({ type: "SET_DEVICE", device })}
        onZoom={(zoom) => saveLayout({ ...layout, zoom, fit: false })}
        onFit={() => saveLayout({ ...layout, fit: !layout.fit })}
        onTheme={changeTheme}
        onSelectMode={toggleSelectMode}
        onRefresh={() => void refresh()}
        onFullScreen={() => dispatchView({ type: "TOGGLE_FULL_SCREEN" })}
      />

      <aside className="ws-pane ws-pane-r" aria-label="Canvas Agent">
        <div
          className="ws-resize ws-resize-l"
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label="Resize the agent panel"
          aria-valuenow={Math.round(layout.agentWidth)}
          aria-valuemin={AGENT_RANGE[0]}
          aria-valuemax={AGENT_RANGE[1]}
          aria-valuetext={`${Math.round(layout.agentWidth)} pixels wide`}
          onPointerDown={() => setResizing("agent")}
          onKeyDown={resizeKeys("agent")}
        />
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
          sectionUsage={selectedSectionUsage}
          sectionBusy={sectionBusy}
          sectionError={sectionError}
          onRemoveSection={() => void removeSelectedSection()}
          onAddSection={() => setAddSectionOpen(true)}
          queue={queuedFollowUps}
          onPrompt={setPrompt}
          onMedia={setSelectedMediaIds}
          onClearSelection={clearSelection}
          onSubmit={() => void submitPrompt()}
          onCancel={() => void cancelJob()}
          onCancelQueued={(id) => void cancelQueued(id)}
          onEditQueued={(item, value) => void editQueued(item, value)}
          onReview={setReviewJobId}
          onHide={toggleAgent}
          onOpenHistory={openVersions}
        />
      </aside>
    </div>

    <footer className="ws-statusbar">
      <span className={`ws-sb-note ${phase === "error" ? "ws-sb-bad" : phase === "idle" ? "ws-sb-ok" : ""}`}>
        {phase === "error" ? <CircleAlert size={12} aria-hidden="true" /> : phase === "idle" ? <CircleCheck size={12} aria-hidden="true" /> : <LoaderCircle className="spin" size={12} aria-hidden="true" />}
        {phaseLabel}
      </span>
      <span className="ws-sb-sep" aria-hidden="true" />
      <span className="ws-sb-note"><FileText size={12} aria-hidden="true" />{currentPage?.name ?? "No page open"}</span>
      <span className="ws-sb-spacer" />
      {queuedFollowUps.filter((item) => item.status === "queued" || item.status === "paused").length ? <button type="button" className="ws-sb-btn" onClick={() => setTaskCenterOpen(true)}><Bot size={12} />{queuedFollowUps.filter((item) => item.status === "queued" || item.status === "paused").length} queued</button> : null}
      {taskSummary.some((task) => task.status === "active") ? <button type="button" className="ws-sb-btn" onClick={() => setTaskCenterOpen(true)}><LoaderCircle className="spin" size={12} />{taskSummary.filter((task) => task.status === "active").length} active</button> : null}
      {showCheckpointNudge ? <span className="ws-sb-nudge" role="status">
        <button type="button" className="ws-sb-btn" onClick={() => { setCheckpointNudgeFrom(history.pendingChanges); openCheckpoints(); }}><Save size={12} />{history.pendingChanges} changes since your last checkpoint — save one</button>
        <button type="button" className="ws-sb-dismiss" aria-label="Dismiss the checkpoint suggestion" onClick={() => setCheckpointNudgeFrom(history.pendingChanges)}><X size={11} /></button>
      </span> : null}
    </footer>

    <nav className="ws-mobile-switcher" aria-label="Workspace surface"><button type="button" aria-pressed={layout.mobileSurface === "tools"} onClick={() => showMobileSurface("tools")}><FileText size={15} />Tools</button><button type="button" aria-pressed={layout.mobileSurface === "preview"} onClick={() => showMobileSurface("preview")}><FileText size={15} />Preview</button><button type="button" aria-pressed={layout.mobileSurface === "agent"} onClick={() => showMobileSurface("agent")}><Bot size={15} />Agent</button></nav>

    <CommandPalette projectId={projectId} userId={userId} open={paletteOpen} commands={commands} pages={commandPages} onClose={() => setPaletteOpen(false)} onPage={(page) => { if (page.type === "page") selectPage(page.id, page.routePath ?? undefined); else selectActivity("website"); }} />
    <TaskCenter projectId={projectId} open={taskCenterOpen} onClose={() => setTaskCenterOpen(false)} onReview={setReviewJobId} onOpenExport={() => openPanel("export")} onReopenAgent={() => { if (!layout.agent) toggleAgent(); }} />
    <AddSectionDialog
      projectId={projectId}
      open={addSectionOpen}
      pageId={currentPageId}
      pageName={currentPage?.name ?? "this page"}
      selectionAnchor={selection?.usageKey ?? selection?.canvasId ?? null}
      projectSections={Object.values(session.manifest.blocks).map((block) => ({ id: block.id, name: block.name, isGlobal: block.isGlobal, contentStatus: block.contentStatus }))}
      onClose={() => setAddSectionOpen(false)}
      onAdded={onSectionAdded}
    />
    <ChangeReview projectId={projectId} jobId={reviewJobId} onClose={() => setReviewJobId(null)} onOpenPage={(id, pageRoute) => { setReviewJobId(null); selectPage(id, pageRoute ?? undefined); }} onOpenBlock={() => { setReviewJobId(null); openPanel("blocks"); }} onHistory={() => { setReviewJobId(null); openVersions(); }} onChanged={onHistoryChanged} />
  </div>;
}


/** A friendly stand-in for the site's own domain in the address bar. */
function hostLabel(companyName: string) {
  const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug ? `${slug}.site` : "your-website.site";
}
