"use client";

import { CircleAlert, Clock, LoaderCircle, Redo2, RotateCcw, Save, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type HistoryEntry = { id: string; operation: string; summary: string; reversible: boolean; undone: boolean; actor: string; createdAt: string };
type HistoryState = { undo: { id: string; summary: string } | null; redo: { id: string; summary: string } | null; history: HistoryEntry[] };
type VersionEntry = { id: string; versionNumber: number; createdAt: string; actor: string; summary: string | null; isCurrent: boolean };
type Checkpoint = { id: string; name: string; actor: string; createdAt: string; pageCount: number; blockCount: number };
export type HistoryTarget = { kind: "page" | "block"; id: string; name?: string } | null;

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const value = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(value.error || "Canvas could not complete this request.");
  return value;
}
function when(value: string) { return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }

/**
 * Undo/Redo plus progressively disclosed Version History and checkpoints. All history
 * logic lives in the domain services; this component only calls them and reports state.
 */
export function HistoryControls({ projectId, target, onChanged, showCheckpoints = false }: { projectId: string; target: HistoryTarget; onChanged: () => void; showCheckpoints?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<HistoryState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [tab, setTab] = useState<"versions" | "checkpoints">("versions");
  const [versions, setVersions] = useState<{ currentVersionId: string | null; versions: VersionEntry[] } | null>(null);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[] | null>(null);
  const [checkpointName, setCheckpointName] = useState("");

  const loadState = useCallback(async () => {
    try { setState(await request<HistoryState>(`/api/projects/${projectId}/history`)); }
    catch { setState(null); }
  }, [projectId]);
  useEffect(() => { let active = true; const timer = window.setTimeout(() => { if (active) void loadState(); }, 0); return () => { active = false; window.clearTimeout(timer); }; }, [loadState]);

  const versionsUrl = target ? (target.kind === "page" ? `/api/projects/${projectId}/pages/${target.id}/versions` : `/api/projects/${projectId}/blocks/${target.id}/versions`) : null;
  const loadVersions = useCallback(async () => {
    if (!versionsUrl) { setVersions(null); return; }
    try { setVersions(await request(versionsUrl)); } catch (cause) { setVersions(null); setError(cause instanceof Error ? cause.message : undefined); }
  }, [versionsUrl]);
  const loadCheckpoints = useCallback(async () => {
    try { setCheckpoints((await request<{ checkpoints: Checkpoint[] }>(`/api/projects/${projectId}/checkpoints`)).checkpoints); } catch { setCheckpoints([]); }
  }, [projectId]);

  async function run(operation: () => Promise<string>) {
    setBusy(true); setError(undefined); setNotice(undefined);
    try {
      setNotice(await operation());
      await Promise.all([loadState(), loadVersions(), showCheckpoints ? loadCheckpoints() : Promise.resolve()]);
      onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Canvas could not complete this request."); }
    finally { setBusy(false); }
  }

  function openHistory(next: "versions" | "checkpoints") {
    setTab(next); setError(undefined); setNotice(undefined);
    void loadVersions(); if (showCheckpoints) void loadCheckpoints();
    dialog.current?.showModal();
  }

  const undoLabel = state?.undo ? `Undo: ${state.undo.summary}` : "Nothing to undo";
  const redoLabel = state?.redo ? `Redo: ${state.redo.summary}` : "Nothing to redo";
  return <>
    <div className="history-controls" role="group" aria-label="History">
      <Button type="button" variant="ghost" title={undoLabel} aria-label={undoLabel} disabled={busy || !state?.undo}
        onClick={() => void run(async () => `Undid ${(await request<{ source: { summary: string } }>(`/api/projects/${projectId}/history/undo`, { method: "POST" })).source.summary}`)}><Undo2 size={15} />Undo</Button>
      <Button type="button" variant="ghost" title={redoLabel} aria-label={redoLabel} disabled={busy || !state?.redo}
        onClick={() => void run(async () => `Redid ${(await request<{ source: { summary: string } }>(`/api/projects/${projectId}/history/redo`, { method: "POST" })).source.summary}`)}><Redo2 size={15} />Redo</Button>
      <Button type="button" variant="ghost" onClick={() => openHistory("versions")}><Clock size={15} />History</Button>
    </div>
    {error ? <p className="history-inline-error" role="alert"><CircleAlert size={13} />{error}</p> : null}
    {notice && !error ? <p className="history-inline-notice" role="status">{notice}</p> : null}

    <dialog className="dialog" ref={dialog} onClick={(event) => { if (event.target === dialog.current) dialog.current?.close(); }}>
      <div className="dialog-panel history-panel">
        <div className="dialog-header">
          <div><h2>History</h2><p>{target?.name ? `Versions for ${target.name}` : "Browse and restore earlier work."}</p></div>
          <Button variant="ghost" aria-label="Close history" onClick={() => dialog.current?.close()}><X size={18} /></Button>
        </div>
        {showCheckpoints ? <div className="segmented compact" role="group" aria-label="History view">
          <button type="button" className={tab === "versions" ? "active" : ""} onClick={() => setTab("versions")}>Versions</button>
          <button type="button" className={tab === "checkpoints" ? "active" : ""} onClick={() => setTab("checkpoints")}>Checkpoints</button>
        </div> : null}
        {error ? <p className="history-inline-error" role="alert"><CircleAlert size={13} />{error}</p> : null}
        {notice && !error ? <p className="history-inline-notice" role="status">{notice}</p> : null}

        {tab === "versions" ? <div className="history-list">
          {!target ? <p className="inline-empty">Select a page or block to see its versions.</p>
            : !versions ? <p className="inline-empty"><LoaderCircle className="spin" size={13} /> Loading versions…</p>
            : versions.versions.length === 0 ? <p className="inline-empty">No versions yet. Create this with Canvas first.</p>
            : versions.versions.map((version) => <div key={version.id} className={`history-row ${version.isCurrent ? "current" : ""}`}>
              <div><strong>Version {version.versionNumber}{version.isCurrent ? " · Active" : ""}</strong><small>{when(version.createdAt)} · {version.actor}</small>{version.summary ? <span>{version.summary}</span> : null}</div>
              {version.isCurrent ? <span className="history-current-tag">Active</span> : <Button type="button" variant="secondary" disabled={busy}
                onClick={() => void run(async () => { const url = target.kind === "page" ? `/api/projects/${projectId}/pages/${target.id}/versions/${version.id}/restore` : `/api/projects/${projectId}/blocks/${target.id}/versions/${version.id}/restore`; await request(url, { method: "POST" }); return `Restored version ${version.versionNumber}.`; })}><RotateCcw size={13} />Restore</Button>}
            </div>)}
        </div> : <div className="history-list">
          <form className="history-checkpoint-form" action={() => void run(async () => { await request(`/api/projects/${projectId}/checkpoints`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: checkpointName }) }); setCheckpointName(""); return "Checkpoint saved."; })}>
            <input className="input" value={checkpointName} maxLength={120} placeholder="Before pricing rework" aria-label="Checkpoint name" onChange={(event) => setCheckpointName(event.target.value)} />
            <Button type="submit" disabled={busy || !checkpointName.trim()}><Save size={14} />Save checkpoint</Button>
          </form>
          {!checkpoints ? <p className="inline-empty"><LoaderCircle className="spin" size={13} /> Loading checkpoints…</p>
            : checkpoints.length === 0 ? <p className="inline-empty">No checkpoints yet. Save one before a big change.</p>
            : checkpoints.map((checkpoint) => <div key={checkpoint.id} className="history-row">
              <div><strong>{checkpoint.name}</strong><small>{when(checkpoint.createdAt)} · {checkpoint.actor}</small><span>{checkpoint.pageCount} pages · {checkpoint.blockCount} blocks</span></div>
              <Button type="button" variant="secondary" disabled={busy}
                onClick={() => void run(async () => { const result = await request<{ restored: { pages: number; blocks: number }; skipped: string[] }>(`/api/projects/${projectId}/checkpoints/${checkpoint.id}/restore`, { method: "POST" }); return `Restored ${result.restored.pages} pages and ${result.restored.blocks} blocks${result.skipped.length ? ` · ${result.skipped.length} skipped` : ""}.`; })}><RotateCcw size={13} />Restore</Button>
            </div>)}
        </div>}

        {state?.history.length ? <details className="history-activity"><summary>Recent activity</summary><ul>{state.history.slice(0, 12).map((entry) => <li key={entry.id}><span>{entry.summary}</span><small>{entry.actor} · {when(entry.createdAt)}{entry.undone ? " · undone" : ""}</small></li>)}</ul></details> : null}
      </div>
    </dialog>
  </>;
}
