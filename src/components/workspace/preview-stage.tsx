"use client";

import { ArrowLeft, ArrowRight, Check, ExternalLink, Scan, Globe, LoaderCircle, Maximize2, Minimize2, Monitor, Moon, MoreHorizontal, MousePointerClick, Plus, RefreshCw, Smartphone, Sun, Tablet, Minus } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { PREVIEW_IFRAME_SANDBOX } from "@/generated-runtime/security/headers";

export type Device = "desktop" | "tablet" | "mobile";
const DEVICES: Array<{ id: Device; label: string; width: number; icon: typeof Monitor }> = [{ id: "desktop", label: "Desktop", width: 1440, icon: Monitor }, { id: "tablet", label: "Tablet", width: 834, icon: Tablet }, { id: "mobile", label: "Phone", width: 390, icon: Smartphone }];

export function PreviewStage({ frame, frameSrc, sandboxTitle, device, route, host, pages, status, error, selectMode, fullScreen, theme, zoom, fit, canBack, canForward, onBack, onForward, onPage, onDevice, onZoom, onFit, onTheme, onSelectMode, onRefresh, onFullScreen }: {
  frame: RefObject<HTMLIFrameElement | null>; frameSrc: string; sandboxTitle: string; device: Device; route: string; host: string; pages: Array<{ id: string; name: string; route: string }>;
  status: "loading" | "ready" | "error"; error?: string; selectMode: boolean; fullScreen: boolean; theme: "light" | "dark"; zoom: number; fit: boolean; canBack: boolean; canForward: boolean;
  onBack: () => void; onForward: () => void; onPage: (route: string) => void; onDevice: (device: Device) => void; onZoom: (zoom: number) => void; onFit: () => void; onTheme: (theme: "light" | "dark") => void; onSelectMode: () => void; onRefresh: () => void; onFullScreen: () => void;
}) {
  const canvas = useRef<HTMLDivElement>(null); const [availableWidth, setAvailableWidth] = useState(1200); const [overflow, setOverflow] = useState(false);
  useEffect(() => { const node = canvas.current; if (!node) return; const observer = new ResizeObserver(([entry]) => { if (entry) setAvailableWidth(entry.contentRect.width); }); observer.observe(node); return () => observer.disconnect(); }, []);
  const preset = DEVICES.find((item) => item.id === device)!; const fitted = Math.min(100, Math.max(35, ((availableWidth - 28) / preset.width) * 100)); const effectiveZoom = fit ? fitted : zoom; const scale = effectiveZoom / 100;
  const pageName = pages.find((page) => page.route === route)?.name ?? route;
  const statusText = status === "loading" ? "Loading preview" : status === "error" ? "Preview unavailable" : selectMode ? "Selection mode on. Choose an element in the website." : "Preview ready";
  return <section className="ws-stage" aria-label="Website preview">
    <div className="ws-stage-bar">
      <div className="ws-tool-group" role="group" aria-label="Preview navigation"><ToolButton label="Back" disabled={!canBack} onClick={onBack}><ArrowLeft size={15} /></ToolButton><ToolButton label="Forward" disabled={!canForward} onClick={onForward}><ArrowRight size={15} /></ToolButton><ToolButton label="Refresh preview" onClick={onRefresh}>{status === "loading" ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}</ToolButton></div>
      <label className="ws-page-picker"><Globe size={13} /><span>{host}</span><select aria-label="Current preview page" value={route} onChange={(event) => onPage(event.target.value)}>{pages.map((page) => <option key={page.id} value={page.route}>{page.name} · {page.route}</option>)}</select></label>
      <div className="ws-tool-group ws-device-controls" role="group" aria-label="Preview size">{DEVICES.map(({ id, label, icon: Icon }) => <ToolButton key={id} label={label} pressed={device === id} onClick={() => onDevice(id)}><Icon size={15} /></ToolButton>)}</div>
      <div className="ws-tool-divider" />
      <div className="ws-tool-group ws-zoom" role="group" aria-label="Preview zoom"><ToolButton label="Zoom out" disabled={effectiveZoom <= 50 && !fit} onClick={() => onZoom(Math.max(50, zoom - 10))}><Minus size={14} /></ToolButton><button type="button" className="ws-zoom-value" title="Preview zoom" onClick={onFit}>{Math.round(effectiveZoom)}%</button><ToolButton label="Zoom in" disabled={effectiveZoom >= 150} onClick={() => onZoom(Math.min(150, Math.round(effectiveZoom / 10) * 10 + 10))}><Plus size={14} /></ToolButton><ToolButton label="Fit preview to area" pressed={fit} onClick={onFit}><Scan size={14} /></ToolButton></div>
      <div className="ws-tool-divider" />
      <ToolButton label={selectMode ? "Stop selecting elements" : "Select an element to edit"} pressed={selectMode} onClick={onSelectMode}><MousePointerClick size={15} /></ToolButton>
      <div className="ws-overflow"><ToolButton label="More preview options" expanded={overflow} onClick={() => setOverflow((value) => !value)}><MoreHorizontal size={16} /></ToolButton>{overflow ? <div className="ws-overflow-menu" role="menu" onClick={() => setOverflow(false)}><button type="button" role="menuitem" onClick={() => onTheme("light")}><Sun size={14} />Light appearance{theme === "light" ? <Check size={14} /> : null}</button><button type="button" role="menuitem" onClick={() => onTheme("dark")}><Moon size={14} />Dark appearance{theme === "dark" ? <Check size={14} /> : null}</button><button type="button" role="menuitem" onClick={() => window.open(frameSrc, "_blank", "noopener,noreferrer")}><ExternalLink size={14} />Open preview in new tab</button><button type="button" role="menuitem" onClick={onFullScreen}>{fullScreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}{fullScreen ? "Exit focus mode" : "Focus on preview"}</button></div> : null}</div>
    </div>
    <div className="ws-preview-meta"><strong>{pageName}</strong><span>{route}</span><span className="ws-preview-size">{preset.label} · {preset.width}px · {Math.round(effectiveZoom)}%</span></div>
    <div className="ws-preview-live" role="status" aria-live="polite">{statusText}</div>
    <div className="ws-canvas" ref={canvas}>
      {status === "error" ? <div className="ws-stage-overlay" role="alert"><div className="ws-stage-msg"><h2>The preview could not be loaded.</h2><p>{error ?? "Check the preview configuration, then try again."}</p><button type="button" className="button button-primary" onClick={onRefresh}><RefreshCw size={14} />Try again</button></div></div> : null}
      <div className="ws-device-viewport" style={{ width: Math.round(preset.width * scale) }}><div className={`ws-device ws-device-${device}`} style={{ width: preset.width, transform: `scale(${scale})`, height: `${100 / scale}%` }}><iframe ref={frame} src={frameSrc} sandbox={PREVIEW_IFRAME_SANDBOX} title={sandboxTitle} /></div></div>
    </div>
  </section>;
}

function ToolButton({ label, pressed, disabled, expanded, onClick, children }: { label: string; pressed?: boolean; disabled?: boolean; expanded?: boolean; onClick: () => void; children: React.ReactNode }) { return <button type="button" className="ws-tool-button" title={label} aria-label={label} aria-pressed={pressed} aria-expanded={expanded} disabled={disabled} onClick={onClick}>{children}</button>; }
