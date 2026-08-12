"use client";

import Link from "next/link";
import { Check, ExternalLink, FileText, Folder, House, LoaderCircle, Maximize2, Monitor, Moon, RefreshCw, Smartphone, Sun, Tablet, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ProjectPreviewManifest, PreviewNavigationItem } from "@/generated-runtime/manifest/schema";
import { parsePreviewParentMessage, type ParentPreviewMessage } from "@/generated-runtime/runtime/messages";
import { initialPreviewRoute } from "@/generated-runtime/runtime/router";
import { builderViewReducer, INITIAL_BUILDER_VIEW } from "@/generated-runtime/runtime/builder-state";
import { PREVIEW_IFRAME_SANDBOX } from "@/generated-runtime/security/headers";

type PreviewSession = { token: string; expiresAt: string; manifest: ProjectPreviewManifest };
type ParentPreviewCommand = ParentPreviewMessage extends infer Message ? Message extends { sessionId: string; instanceId: string } ? Omit<Message, "sessionId" | "instanceId"> : never : never;

export function BuilderWorkspace({ projectId, initialSession, initialPageId, initialInstanceId }: { projectId: string; initialSession: PreviewSession; initialPageId?: string; initialInstanceId: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const initialRoute = initialPreviewRoute(initialSession.manifest, initialPageId);
  const [session, setSession] = useState(initialSession); const [instanceId, setInstanceId] = useState(initialInstanceId);
  const [route, setRoute] = useState(initialRoute); const [frameSrc, setFrameSrc] = useState(() => `/preview/${encodeURIComponent(initialSession.token)}?route=${encodeURIComponent(initialRoute)}&mode=light&instance=${initialInstanceId}`);
  const [view, dispatchView] = useReducer(builderViewReducer, INITIAL_BUILDER_VIEW);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading"); const [error, setError] = useState<string>();
  const currentPageId = session.manifest.routes[route]?.pageId ?? null;

  const makeSrc = useCallback((token: string, nextRoute: string, mode: "light" | "dark", instance: string) => `/preview/${encodeURIComponent(token)}?route=${encodeURIComponent(nextRoute)}&mode=${mode}&instance=${instance}`, []);
  useEffect(() => { const listener = (event: MessageEvent) => { const message = parsePreviewParentMessage(event.data, event.origin, event.source === frame.current?.contentWindow, session.manifest.previewSessionId, instanceId); if (!message) return; if (message.type === "CANVAS_PREVIEW_READY") setStatus("ready"); else if (message.type === "CANVAS_PREVIEW_ERROR") { setStatus("error"); setError(message.message); } else if (message.type === "CANVAS_ROUTE_CHANGED") { setRoute(message.route); const page = message.pageId; const url = new URL(window.location.href); if (page) url.searchParams.set("page", page); else url.searchParams.delete("page"); window.history.replaceState(window.history.state, "", url); } }; window.addEventListener("message", listener); return () => window.removeEventListener("message", listener); }, [instanceId, session.manifest.previewSessionId]);
  useEffect(() => { const listener = (event: KeyboardEvent) => { if (event.key === "Escape") dispatchView({ type: "EXIT_FULL_SCREEN" }); }; window.addEventListener("keydown", listener); return () => window.removeEventListener("keydown", listener); }, []);

  function send(message: ParentPreviewCommand) { frame.current?.contentWindow?.postMessage({ ...message, sessionId: session.manifest.previewSessionId, instanceId }, "*"); }
  function navigate(next: string) { setRoute(next); send({ type: "CANVAS_NAVIGATE", route: next }); }
  function changeTheme(mode: "light" | "dark") { dispatchView({ type: "SET_THEME", theme: mode }); send({ type: "CANVAS_SET_THEME", mode }); }
  async function refresh() {
    setStatus("loading"); setError(undefined);
    try {
      const response = await fetch(`/api/projects/${projectId}/preview-session`, { method: "POST" }); const value = await response.json() as PreviewSession & { error?: string };
      if (!response.ok) throw new Error(value.error || "Preview could not be prepared.");
      const retained = value.manifest.routes[route] ? route : initialPreviewRoute(value.manifest, currentPageId); const nextInstance = crypto.randomUUID();
      setSession(value); setRoute(retained); setInstanceId(nextInstance); setFrameSrc(makeSrc(value.token, retained, view.theme, nextInstance));
    } catch (cause) { setStatus("error"); setError(cause instanceof Error ? cause.message : "Preview could not be prepared."); }
  }
  const modeClass = useMemo(() => `preview-device preview-${view.device}`, [view.device]);
  return <div className={`builder-workspace ${view.fullScreen ? "builder-fullscreen" : ""}`}>
    <aside className="builder-pages"><div className="builder-panel-title"><div><p className="eyebrow">Builder</p><h2>Pages</h2></div><Link href={`/projects/${projectId}/pages`} aria-label="Manage pages"><ExternalLink size={15} /></Link></div><BuilderNavigation items={session.manifest.navigation} currentPageId={currentPageId} onNavigate={navigate} /></aside>
    <section className="builder-stage"><div className="builder-toolbar"><div className="builder-device-controls" role="group" aria-label="Preview device"><ToolbarButton active={view.device === "desktop"} label="Desktop" icon={<Monitor size={15} />} onClick={() => dispatchView({ type: "SET_DEVICE", device: "desktop" })} /><ToolbarButton active={view.device === "tablet"} label="Tablet" icon={<Tablet size={15} />} onClick={() => dispatchView({ type: "SET_DEVICE", device: "tablet" })} /><ToolbarButton active={view.device === "mobile"} label="Mobile" icon={<Smartphone size={15} />} onClick={() => dispatchView({ type: "SET_DEVICE", device: "mobile" })} /></div><div className="builder-toolbar-right"><div className="segmented compact" role="group" aria-label="Preview theme"><button type="button" className={view.theme === "light" ? "active" : ""} onClick={() => changeTheme("light")}><Sun size={14} />Light</button><button type="button" className={view.theme === "dark" ? "active" : ""} onClick={() => changeTheme("dark")}><Moon size={14} />Dark</button></div><Button type="button" variant="ghost" onClick={() => void refresh()} aria-label="Refresh preview"><RefreshCw size={15} />Refresh</Button><Button type="button" variant="secondary" onClick={() => dispatchView({ type: "TOGGLE_FULL_SCREEN" })}>{view.fullScreen ? <X size={15} /> : <Maximize2 size={15} />}{view.fullScreen ? "Exit Full Screen" : "Full Screen"}</Button></div></div>
      <div className="preview-status" role="status">{status === "loading" ? <><LoaderCircle className="spin" size={13} />Loading preview</> : status === "error" ? <><span className="status-error-dot" />Preview error</> : <><Check size={13} />Preview ready</>}</div>
      <div className="preview-canvas">{status === "error" ? <div className="preview-error" role="alert"><h2>Preview could not be loaded.</h2><p>{error}</p><Button type="button" onClick={() => void refresh()}>Try again</Button></div> : null}<div className={modeClass}>{frameSrc ? <iframe ref={frame} src={frameSrc} sandbox={PREVIEW_IFRAME_SANDBOX} title={`${session.manifest.brand.companyName} website preview`} /> : <div className="preview-loading"><LoaderCircle className="spin" />Loading preview…</div>}</div></div>
    </section>
  </div>;
}

function ToolbarButton({ active, label, icon, onClick }: { active: boolean; label: string; icon: React.ReactNode; onClick: () => void }) { return <button type="button" className={active ? "active" : ""} aria-pressed={active} onClick={onClick}>{icon}{label}</button>; }
function BuilderNavigation({ items, currentPageId, onNavigate }: { items: PreviewNavigationItem[]; currentPageId: string | null; onNavigate: (route: string) => void }) { return <ul className="builder-page-tree">{items.map((item) => <li key={item.id}>{item.type === "group" ? <><span className="builder-folder"><Folder size={14} />{item.label}</span><BuilderNavigation items={item.children} currentPageId={currentPageId} onNavigate={onNavigate} /></> : <><button type="button" className={item.id === currentPageId ? "active" : ""} onClick={() => onNavigate(item.route)}>{item.route === "/" ? <House size={14} /> : <FileText size={14} />}<span>{item.label}</span>{item.route === "/" ? <small>Home</small> : null}</button>{item.children.length ? <BuilderNavigation items={item.children} currentPageId={currentPageId} onNavigate={onNavigate} /> : null}</>}</li>)}</ul>; }
