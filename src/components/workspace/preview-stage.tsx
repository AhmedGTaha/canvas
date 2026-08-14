"use client";

import { ArrowLeft, ArrowRight, Check, ExternalLink, FilePlus2, Globe, LoaderCircle, Maximize2, Minimize2, Monitor, Moon, MoreHorizontal, MousePointerClick, Plus, RefreshCw, Scan, Smartphone, Sun, Tablet, Minus } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { PREVIEW_IFRAME_SANDBOX } from "@/generated-runtime/security/headers";

export type Device = "desktop" | "tablet" | "mobile";
const DEVICES: Array<{ id: Device; label: string; width: number; icon: typeof Monitor }> = [
  { id: "desktop", label: "Desktop", width: 1440, icon: Monitor },
  { id: "tablet", label: "Tablet", width: 834, icon: Tablet },
  { id: "mobile", label: "Phone", width: 390, icon: Smartphone },
];
const CANVAS_PADDING = 28;

/**
 * The website, and the controls for looking at it.
 *
 * One toolbar, read left to right as navigate → what you are looking at →
 * how you are looking at it → act on it. The row of metadata that used to sit
 * under the toolbar repeated every one of those and is gone; the page and its
 * route are stated once, in the address bar, which is also how you switch page.
 */
export function PreviewStage({
  frame, frameSrc, sandboxTitle, device, route, host, pages, status, error, selectMode, fullScreen, theme, zoom, fit,
  canBack, canForward, empty, onBack, onForward, onPage, onDevice, onZoom, onFit, onTheme, onSelectMode, onRefresh, onFullScreen, onFrameLoad,
}: {
  frame: RefObject<HTMLIFrameElement | null>; frameSrc: string; sandboxTitle: string; device: Device; route: string; host: string;
  pages: Array<{ id: string; name: string; route: string }>;
  status: "loading" | "ready" | "error"; error?: string; selectMode: boolean; fullScreen: boolean; theme: "light" | "dark"; zoom: number; fit: boolean;
  canBack: boolean; canForward: boolean; empty?: ReactNode;
  onBack: () => void; onForward: () => void; onPage: (route: string) => void; onDevice: (device: Device) => void; onZoom: (zoom: number) => void;
  onFit: () => void; onTheme: (theme: "light" | "dark") => void; onSelectMode: () => void; onRefresh: () => void; onFullScreen: () => void; onFrameLoad?: () => void;
}) {
  const canvas = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState<number | null>(null);
  const [overflow, setOverflow] = useState(false);

  /*
   * Measured before the browser paints, not after.
   *
   * With a guessed starting width the first frame sized the device to a canvas
   * that did not exist — 1172px of website inside a 716px column — and the user
   * saw a clipped page for as long as it took the observer to fire. Until the
   * real width is known nothing is scaled at all.
   */
  useLayoutEffect(() => {
    const node = canvas.current;
    if (!node) return;
    // Padding is excluded on both paths: the canvas pads itself, and where the
    // agent floats over the stage that padding is what keeps the website out
    // from under it.
    const style = window.getComputedStyle(node);
    setAvailableWidth(node.clientWidth - parseFloat(style.paddingLeft || "0") - parseFloat(style.paddingRight || "0"));
    const observer = new ResizeObserver(([entry]) => { if (entry) setAvailableWidth(entry.contentRect.width); });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const preset = DEVICES.find((item) => item.id === device)!;
  const fitted = availableWidth === null ? 100 : Math.min(100, Math.max(20, ((availableWidth - CANVAS_PADDING) / preset.width) * 100));
  const effectiveZoom = fit ? fitted : zoom;
  const scale = effectiveZoom / 100;
  // Zoomed past the space available, the canvas scrolls rather than clipping.
  const viewportWidth = Math.round(preset.width * scale);
  const statusText = status === "loading" ? "Loading the website"
    : status === "error" ? "The website preview is unavailable"
    : selectMode ? "Selection mode is on. Choose a part of the website."
    : "The website is up to date";

  return <section className="ws-stage" aria-label="Website preview">
    <div className="ws-stage-bar">
      <div className="ws-tool-group" role="group" aria-label="Preview navigation">
        <ToolButton label="Back" disabled={!canBack} onClick={onBack}><ArrowLeft size={15} /></ToolButton>
        <ToolButton label="Forward" disabled={!canForward} onClick={onForward}><ArrowRight size={15} /></ToolButton>
        <ToolButton label="Reload the website" onClick={onRefresh}>{status === "loading" ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}</ToolButton>
      </div>

      <label className="ws-page-picker">
        <Globe size={13} aria-hidden="true" />
        <span>{host}</span>
        <select aria-label="Page shown in the preview" value={route} onChange={(event) => onPage(event.target.value)}>
          {pages.length
            ? pages.map((page) => <option key={page.id} value={page.route}>{page.name} · {page.route}</option>)
            : <option value={route}>No pages yet</option>}
        </select>
      </label>

      <div className="ws-tool-group ws-device-controls" role="group" aria-label="Screen size">
        {DEVICES.map(({ id, label, icon: Icon }) => <ToolButton key={id} label={label} pressed={device === id} onClick={() => onDevice(id)}><Icon size={15} /></ToolButton>)}
      </div>
      <div className="ws-tool-divider" />
      <div className="ws-tool-group ws-zoom" role="group" aria-label="Zoom">
        <ToolButton label="Zoom out" disabled={effectiveZoom <= 50 && !fit} onClick={() => onZoom(Math.max(50, Math.round(effectiveZoom / 10) * 10 - 10))}><Minus size={14} /></ToolButton>
        <button type="button" className="ws-zoom-value" title={fit ? "Zoom: fit to the space available" : "Zoom"} onClick={onFit}>{Math.round(effectiveZoom)}%</button>
        <ToolButton label="Zoom in" disabled={effectiveZoom >= 150} onClick={() => onZoom(Math.min(150, Math.round(effectiveZoom / 10) * 10 + 10))}><Plus size={14} /></ToolButton>
        <ToolButton label="Fit the website to the space" pressed={fit} onClick={onFit}><Scan size={14} /></ToolButton>
      </div>
      <div className="ws-tool-divider" />
      <ToolButton label={selectMode ? "Stop picking a part of the website" : "Pick a part of the website to edit"} pressed={selectMode} onClick={onSelectMode}><MousePointerClick size={15} /></ToolButton>

      <div className="ws-overflow">
        <ToolButton label="More preview options" expanded={overflow} onClick={() => setOverflow((value) => !value)}><MoreHorizontal size={16} /></ToolButton>
        {overflow ? <div className="ws-overflow-menu" role="menu" onClick={() => setOverflow(false)}>
          <button type="button" role="menuitem" onClick={() => onTheme("light")}><Sun size={14} />Light appearance{theme === "light" ? <Check size={14} /> : null}</button>
          <button type="button" role="menuitem" onClick={() => onTheme("dark")}><Moon size={14} />Dark appearance{theme === "dark" ? <Check size={14} /> : null}</button>
          <button type="button" role="menuitem" onClick={() => window.open(frameSrc, "_blank", "noopener,noreferrer")}><ExternalLink size={14} />Open in a new tab</button>
          <button type="button" role="menuitem" onClick={onFullScreen}>{fullScreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}{fullScreen ? "Leave focus mode" : "Focus on the website"}</button>
        </div> : null}
      </div>
    </div>

    <div className="ws-preview-live" role="status" aria-live="polite">{statusText}</div>

    <div className="ws-canvas" ref={canvas}>
      {status === "error" ? <div className="ws-stage-overlay" role="alert">
        <div className="ws-stage-msg">
          <h2>The website preview could not be loaded</h2>
          <p>{error ?? "Your pages and content are safe. Reload the preview to try again."}</p>
          <button type="button" className="button button-primary" onClick={onRefresh}><RefreshCw size={14} />Reload the website</button>
        </div>
      </div> : null}

      {/* A website with no pages has nothing to preview, and showing the
          generated site's own 404 told the user they were lost rather than that
          they had not started. */}
      {status !== "error" && empty ? <div className="ws-stage-overlay">
        <div className="ws-stage-msg">
          <FilePlus2 size={22} aria-hidden="true" />
          {empty}
        </div>
      </div> : null}

      <div className="ws-device-viewport" style={{ width: viewportWidth }}>
        <div className={`ws-device ws-device-${device}`} style={{ width: preset.width, transform: `scale(${scale})`, height: `${100 / scale}%` }}>
          <iframe ref={frame} src={frameSrc} sandbox={PREVIEW_IFRAME_SANDBOX} title={sandboxTitle} onLoad={onFrameLoad} />
        </div>
      </div>
    </div>
  </section>;
}

function ToolButton({ label, pressed, disabled, expanded, onClick, children }: {
  label: string; pressed?: boolean; disabled?: boolean; expanded?: boolean; onClick: () => void; children: ReactNode;
}) {
  return <button type="button" className="ws-tool-button" title={label} aria-label={label} aria-pressed={pressed} aria-expanded={expanded} disabled={disabled} onClick={onClick}>{children}</button>;
}
