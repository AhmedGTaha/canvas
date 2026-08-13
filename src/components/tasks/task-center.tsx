"use client";

import { CircleAlert, Download, LoaderCircle, RotateCcw, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectTask } from "@/domain/tasks/model";

export function TaskCenter({ projectId, open, onClose, onReview, onOpenExport, onReopenAgent }: { projectId: string; open: boolean; onClose: () => void; onReview: (jobId: string) => void; onOpenExport: () => void; onReopenAgent: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null); const [tasks, setTasks] = useState<ProjectTask[]>([]); const [error, setError] = useState<string>();
  const load = useCallback(async () => { try { const response = await fetch(`/api/projects/${projectId}/tasks`, { cache: "no-store" }); const value = await response.json() as { tasks?: ProjectTask[]; error?: string }; if (!response.ok) throw new Error(value.error); setTasks(value.tasks ?? []); setError(undefined); } catch { setError("Background work could not be refreshed. Your website remains safe; try again."); } }, [projectId]);
  useEffect(() => { if (open) { if (!dialog.current?.open) dialog.current?.showModal(); const timer = window.setTimeout(() => void load(), 0); return () => clearTimeout(timer); } else if (dialog.current?.open) dialog.current.close(); }, [load, open]);
  useEffect(() => { if (!open || !tasks.some((task) => task.status === "active")) return; const timer = setInterval(() => void load(), 1_500); return () => clearInterval(timer); }, [load, open, tasks]);
  const close = () => { dialog.current?.close(); onClose(); };
  return <dialog className="task-dialog" ref={dialog} aria-labelledby="task-center-title" onCancel={(event) => { event.preventDefault(); close(); }}>
    <div className="task-center">
      <header><div><h2 id="task-center-title">Background tasks</h2><p>AI updates and exports for this project.</p></div><button type="button" aria-label="Close background tasks" onClick={close}><X size={17} /></button></header>
      {error ? <p className="task-error" role="alert"><CircleAlert size={14} />{error}</p> : null}
      <div className="task-list">{!tasks.length && !error ? <p className="command-empty">No background work yet.</p> : tasks.map((task) => <article key={`${task.type}:${task.id}`} className={`task-row task-${task.status}`}>
        <span className="task-icon">{task.status === "active" ? <LoaderCircle className="spin" size={15} /> : task.type === "generation" ? <Sparkles size={15} /> : <Download size={15} />}</span>
        <div><strong>{task.type === "generation" ? `AI update · ${task.target}` : task.target}</strong><span>{task.stage} · {task.initiator}</span><small>{new Date(task.startedAt).toLocaleString()}</small>{task.status === "failed" ? <p><b>What happened:</b> {task.summary || "This task could not finish."} Your saved website was not replaced. You can reopen the tool and try again.</p> : null}</div>
        {task.action?.kind === "review" ? <button type="button" onClick={() => { close(); onReview(task.id); }}>Review changes</button>
          : task.action?.kind === "export" || task.action?.kind === "retry" ? <button type="button" onClick={() => { close(); onOpenExport(); }}>{task.action.kind === "retry" ? <RotateCcw size={13} /> : null}{task.action.kind === "retry" ? "Try export again" : "Open download"}</button>
            : task.action?.kind === "reopen" ? <button type="button" onClick={() => { close(); onReopenAgent(); }}>Reopen agent</button> : null}
      </article>)}</div>
    </div>
  </dialog>;
}

export function TaskIndicator({ activeCount, failedCount, onClick }: { activeCount: number; failedCount: number; onClick: () => void }) {
  const label = activeCount ? `${activeCount} task${activeCount === 1 ? "" : "s"} running` : failedCount ? `${failedCount} task${failedCount === 1 ? "" : "s"} needs attention` : "Background tasks";
  return <button type="button" className={`ws-task-indicator ${activeCount ? "active" : failedCount ? "failed" : ""}`} onClick={onClick} aria-label={label} title={label}>{activeCount ? <LoaderCircle className="spin" size={12} /> : failedCount ? <CircleAlert size={12} /> : <Sparkles size={12} />}<span>{activeCount || failedCount || "Tasks"}</span></button>;
}
