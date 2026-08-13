"use client";

import { Globe, LoaderCircle, Maximize2, Minimize2, Monitor, MousePointerClick, RefreshCw, Smartphone, Tablet } from "lucide-react";
import type { RefObject } from "react";
import { PREVIEW_IFRAME_SANDBOX } from "@/generated-runtime/security/headers";

export type Device = "desktop" | "tablet" | "mobile";

const DEVICES: Array<{ id: Device; label: string; icon: typeof Monitor }> = [
  { id: "desktop", label: "Desktop", icon: Monitor },
  { id: "tablet", label: "Tablet", icon: Tablet },
  { id: "mobile", label: "Phone", icon: Smartphone },
];

/**
 * The website itself. Everything around it is compact so the page under edit
 * gets the screen: a single 40px toolbar, no page heading, no dashboard chrome.
 */
export function PreviewStage({
  frame, frameSrc, sandboxTitle, device, route, host, status, error, selectMode, fullScreen,
  onDevice, onSelectMode, onRefresh, onFullScreen,
}: {
  frame: RefObject<HTMLIFrameElement | null>;
  frameSrc: string;
  sandboxTitle: string;
  device: Device;
  route: string;
  host: string;
  status: "loading" | "ready" | "error";
  error?: string;
  selectMode: boolean;
  fullScreen: boolean;
  onDevice: (device: Device) => void;
  onSelectMode: () => void;
  onRefresh: () => void;
  onFullScreen: () => void;
}) {
  return <section className="ws-stage" aria-label="Website preview">
    <div className="ws-stage-bar">
      <div className="ws-seg" role="group" aria-label="Preview size">
        {DEVICES.map(({ id, label, icon: Icon }) => <button
          key={id}
          type="button"
          title={label}
          aria-label={label}
          aria-pressed={device === id}
          onClick={() => onDevice(id)}
        ><Icon size={13} aria-hidden="true" /></button>)}
      </div>

      {/* The current address, so it is always clear which page is on screen. */}
      <p className="ws-urlbar" aria-label="Current page address">
        <Globe size={11} aria-hidden="true" style={{ flex: "none", color: status === "error" ? "var(--danger)" : "var(--success)" }} />
        <span className="ws-urlbar-host">{host}</span>
        <strong>{route}</strong>
      </p>

      <button type="button" className="ws-icon-btn" aria-pressed={selectMode} title={selectMode ? "Stop selecting parts of the page" : "Select a part of the page to edit"} aria-label={selectMode ? "Stop selecting parts of the page" : "Select a part of the page to edit"} onClick={onSelectMode}><MousePointerClick size={14} /></button>
      <button type="button" className="ws-icon-btn" title="Refresh the preview" aria-label="Refresh the preview" onClick={onRefresh}>{status === "loading" ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}</button>
      <button type="button" className="ws-icon-btn" aria-pressed={fullScreen} title={fullScreen ? "Exit full screen (Esc)" : "Full screen"} aria-label={fullScreen ? "Exit full screen" : "Full screen"} onClick={onFullScreen}>{fullScreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
    </div>

    <div className="ws-canvas" style={{ position: "relative" }}>
      {status === "error" ? <div className="ws-stage-overlay" role="alert">
        <div className="ws-stage-msg">
          <h2>The preview could not be loaded.</h2>
          <p>{error ?? "Check the preview configuration, then try again."}</p>
          <button type="button" className="button button-primary" onClick={onRefresh}><RefreshCw size={14} />Try again</button>
        </div>
      </div> : null}

      <div className={`ws-device ws-device-${device}`}>
        <iframe ref={frame} src={frameSrc} sandbox={PREVIEW_IFRAME_SANDBOX} title={sandboxTitle} />
      </div>
    </div>
  </section>;
}
