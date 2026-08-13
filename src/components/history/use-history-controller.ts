"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type HistoryEntry = { id: string; operation: string; summary: string; reversible: boolean; undone: boolean; actor: string; createdAt: string };
export type HistoryState = { undo: { id: string; summary: string } | null; redo: { id: string; summary: string } | null; history: HistoryEntry[]; lastCheckpointAt: string | null; pendingChanges: number };
export type VersionEntry = { id: string; versionNumber: number; createdAt: string; actor: string; summary: string | null; isCurrent: boolean };
export type Checkpoint = { id: string; name: string; actor: string; createdAt: string; pageCount: number; blockCount: number };
export type HistoryTarget = { kind: "page" | "block"; id: string; name?: string } | null;

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const value = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(value.error || "Canvas could not complete this request.");
  return value;
}

/** Short, human dates for a list that is read at a glance, not audited. */
export function whenLabel(value: string) {
  return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * How much uncheckpointed work it takes before Canvas mentions it. High enough
 * that a few edits pass in silence, low enough that a long session does not end
 * with nothing to fall back to.
 */
export const CHECKPOINT_NUDGE_AT = 10;

/**
 * Whether to suggest saving a checkpoint.
 *
 * `dismissedAt` is the count the user last waved away, so dismissing buys
 * silence for another full threshold of work rather than for ever — and
 * resetting it to zero (after a generation finishes, say) offers again at the
 * next natural moment. This is a suggestion, never a block: SRS principle 5 is
 * safe iteration, not nagging.
 */
export function shouldSuggestCheckpoint(pendingChanges: number, dismissedAt: number) {
  return pendingChanges >= dismissedAt + CHECKPOINT_NUDGE_AT;
}

export type HistoryController = {
  busy: boolean;
  error?: string;
  notice?: string;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string;
  redoLabel: string;
  /** Committed changes recorded since the most recent checkpoint. */
  pendingChanges: number;
  hasCheckpoint: boolean;
  activity: HistoryEntry[];
  versions: { currentVersionId: string | null; versions: VersionEntry[] } | null;
  checkpoints: Checkpoint[] | null;
  target: HistoryTarget;
  undo: () => void;
  redo: () => void;
  loadVersions: () => void;
  loadCheckpoints: () => void;
  restoreVersion: (version: VersionEntry) => void;
  restoreCheckpoint: (checkpoint: Checkpoint) => void;
  saveCheckpoint: (name: string) => void;
};

/**
 * Everything History does — undo/redo, immutable versions, checkpoints — with
 * no opinion about where it is drawn.
 *
 * All of it lives in the domain services behind the API routes; this only calls
 * them and reports what came back. It exists as a hook rather than a component
 * so the workspace sidebar and the Reusable Sections panel can render the same
 * state in the shapes that suit them, instead of one of them getting a dialog
 * bolted onto a surface it does not belong on.
 */
export function useHistoryController({ projectId, target, onChanged, withCheckpoints = false }: {
  projectId: string;
  target: HistoryTarget;
  onChanged: () => void;
  withCheckpoints?: boolean;
}): HistoryController {
  const [state, setState] = useState<HistoryState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [versions, setVersions] = useState<{ currentVersionId: string | null; versions: VersionEntry[] } | null>(null);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[] | null>(null);

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

  // Read through a ref so an inline `onChanged` from the caller cannot change
  // the identity of `run`, and with it every callback below it.
  const onChangedRef = useRef(onChanged);
  useEffect(() => { onChangedRef.current = onChanged; }, [onChanged]);

  const run = useCallback(async (operation: () => Promise<string>) => {
    setBusy(true); setError(undefined); setNotice(undefined);
    try {
      setNotice(await operation());
      await Promise.all([loadState(), loadVersions(), withCheckpoints ? loadCheckpoints() : Promise.resolve()]);
      onChangedRef.current();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Canvas could not complete this request."); }
    finally { setBusy(false); }
  }, [loadCheckpoints, loadState, loadVersions, withCheckpoints]);

  const undo = useCallback(() => void run(async () => `Undid ${(await request<{ source: { summary: string } }>(`/api/projects/${projectId}/history/undo`, { method: "POST" })).source.summary}`), [projectId, run]);
  const redo = useCallback(() => void run(async () => `Redid ${(await request<{ source: { summary: string } }>(`/api/projects/${projectId}/history/redo`, { method: "POST" })).source.summary}`), [projectId, run]);

  const restoreVersion = useCallback((version: VersionEntry) => {
    if (!target) return;
    void run(async () => {
      const url = target.kind === "page"
        ? `/api/projects/${projectId}/pages/${target.id}/versions/${version.id}/restore`
        : `/api/projects/${projectId}/blocks/${target.id}/versions/${version.id}/restore`;
      await request(url, { method: "POST" });
      return `Restored version ${version.versionNumber}.`;
    });
  }, [projectId, run, target]);

  const restoreCheckpoint = useCallback((checkpoint: Checkpoint) => void run(async () => {
    const result = await request<{ restored: { pages: number; blocks: number }; skipped: string[] }>(`/api/projects/${projectId}/checkpoints/${checkpoint.id}/restore`, { method: "POST" });
    return `Restored ${result.restored.pages} pages and ${result.restored.blocks} blocks${result.skipped.length ? ` · ${result.skipped.length} skipped` : ""}.`;
  }), [projectId, run]);

  const saveCheckpoint = useCallback((name: string) => void run(async () => {
    await request(`/api/projects/${projectId}/checkpoints`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    return "Checkpoint saved.";
  }), [projectId, run]);

  const startVersions = useCallback(() => { void loadVersions(); }, [loadVersions]);
  const startCheckpoints = useCallback(() => { void loadCheckpoints(); }, [loadCheckpoints]);

  return useMemo(() => ({
    busy, error, notice,
    canUndo: Boolean(state?.undo) && !busy,
    canRedo: Boolean(state?.redo) && !busy,
    undoLabel: state?.undo ? `Undo: ${state.undo.summary}` : "Nothing to undo",
    redoLabel: state?.redo ? `Redo: ${state.redo.summary}` : "Nothing to redo",
    pendingChanges: state?.pendingChanges ?? 0,
    hasCheckpoint: Boolean(state?.lastCheckpointAt),
    activity: state?.history ?? [],
    versions, checkpoints, target,
    undo, redo,
    loadVersions: startVersions,
    loadCheckpoints: startCheckpoints,
    restoreVersion, restoreCheckpoint, saveCheckpoint,
  }), [busy, checkpoints, error, notice, redo, restoreCheckpoint, restoreVersion, saveCheckpoint, startCheckpoints, startVersions, state, target, undo, versions]);
}
