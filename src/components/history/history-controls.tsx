"use client";

import { CircleAlert, LoaderCircle, Redo2, RotateCcw, Save, Undo2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { whenLabel, type HistoryController } from "./use-history-controller";

export type { HistoryTarget } from "./use-history-controller";

/**
 * The pieces History is drawn from.
 *
 * None of them owns a dialog. History used to open a floating modal of its own,
 * which was the one surface in the workspace that did not look like it belonged
 * there — and it broke the rule that anything doable in the sidebar belongs in
 * the sidebar. These render in place instead: the workspace composes them into
 * its History sidebar, and Reusable Sections composes the same ones into the
 * block it is showing.
 */

export function UndoRedoControls({ controller, dense = false }: { controller: HistoryController; dense?: boolean }) {
  return <div className={`history-controls${dense ? " history-controls-dense" : ""}`} role="group" aria-label="History">
    <Button type="button" variant="ghost" title={controller.undoLabel} aria-label={controller.undoLabel} disabled={!controller.canUndo} onClick={controller.undo}><Undo2 size={15} />Undo</Button>
    <Button type="button" variant="ghost" title={controller.redoLabel} aria-label={controller.redoLabel} disabled={!controller.canRedo} onClick={controller.redo}><Redo2 size={15} />Redo</Button>
  </div>;
}

export function HistoryMessages({ controller }: { controller: HistoryController }) {
  if (controller.error) return <p className="history-inline-error" role="alert"><CircleAlert size={13} />{controller.error}</p>;
  if (controller.notice) return <p className="history-inline-notice" role="status">{controller.notice}</p>;
  return null;
}

/** Immutable versions of whatever is being edited, newest first. */
export function VersionList({ controller }: { controller: HistoryController }) {
  const { target, versions, busy } = controller;
  return <div className="history-list">
    {!target ? <p className="quiet-note">Select a page or block to see its versions.</p>
      : !versions ? <p className="quiet-note"><LoaderCircle className="spin" size={13} /> Loading versions…</p>
      : versions.versions.length === 0 ? <p className="quiet-note">No versions yet. Create this with Canvas first.</p>
      : versions.versions.map((version) => <div key={version.id} className={`history-row ${version.isCurrent ? "current" : ""}`}>
        <div><strong>Version {version.versionNumber}{version.isCurrent ? " · Active" : ""}</strong><small>{whenLabel(version.createdAt)} · {version.actor}</small>{version.summary ? <span>{version.summary}</span> : null}</div>
        {version.isCurrent ? <span className="history-current-tag">Active</span>
          : <Button type="button" variant="secondary" disabled={busy} onClick={() => controller.restoreVersion(version)}><RotateCcw size={13} />Restore</Button>}
      </div>)}
  </div>;
}

/** Saving and restoring whole-project checkpoints. */
export function CheckpointList({ controller }: { controller: HistoryController }) {
  const [name, setName] = useState("");
  const { checkpoints, busy } = controller;
  return <div className="history-list">
    <form className="history-checkpoint-form" action={() => { controller.saveCheckpoint(name); setName(""); }}>
      <input className="input" value={name} maxLength={120} placeholder="Before pricing rework" aria-label="Checkpoint name" onChange={(event) => setName(event.target.value)} />
      <Button type="submit" disabled={busy || !name.trim()}><Save size={14} />Save checkpoint</Button>
    </form>
    {!checkpoints ? <p className="quiet-note"><LoaderCircle className="spin" size={13} /> Loading checkpoints…</p>
      : checkpoints.length === 0 ? <p className="quiet-note">No checkpoints yet. Save one before a big change.</p>
      : checkpoints.map((checkpoint) => <div key={checkpoint.id} className="history-row">
        <div><strong>{checkpoint.name}</strong><small>{whenLabel(checkpoint.createdAt)} · {checkpoint.actor}</small><span>{checkpoint.pageCount} pages · {checkpoint.blockCount} blocks</span></div>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => controller.restoreCheckpoint(checkpoint)}><RotateCcw size={13} />Restore</Button>
      </div>)}
  </div>;
}

/** Everything that has happened to the project, newest first. */
export function ActivityList({ controller, limit = 12 }: { controller: HistoryController; limit?: number }) {
  if (!controller.activity.length) return <p className="quiet-note">Nothing has changed yet.</p>;
  return <ul className="history-activity-list">
    {controller.activity.slice(0, limit).map((entry) => <li key={entry.id}>
      <span>{entry.summary}</span>
      <small>{entry.actor} · {whenLabel(entry.createdAt)}{entry.undone ? " · undone" : ""}</small>
    </li>)}
  </ul>;
}
