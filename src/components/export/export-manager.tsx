"use client";

import { Check, CircleAlert, Download, LoaderCircle, Package, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type Failure = { code: string; message: string; entity?: string };
type ExportJob = {
  id: string; status: "queued" | "validating" | "assembling" | "building" | "packaging" | "completed" | "failed";
  progressStage: string; actor: string; createdAt: string; finishedAt: string | null;
  errorCode: string | null; errorMessage: string | null;
  validation: { ok: boolean; checks: Array<{ name: string; passed: boolean }>; failures: Failure[]; pageCount: number; blockCount: number; mediaCount: number } | null;
  artifact: { fileName: string | null; bytes: number | null; fileCount: number | null } | null;
};
const ACTIVE = new Set(["queued", "validating", "assembling", "building", "packaging"]);

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const value = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(value.error || "Canvas could not complete this request.");
  return value;
}
function when(value: string) { return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
function size(bytes: number | null) { return bytes ? `${(bytes / 1024).toLocaleString(undefined, { maximumFractionDigits: 0 })} KB` : ""; }

/** Start an export, follow its progress, read its validation result, download the ZIP. */
export function ExportManager({ projectId }: { projectId: string }) {
  const [jobs, setJobs] = useState<ExportJob[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    try { setJobs((await request<{ exports: ExportJob[] }>(`/api/projects/${projectId}/exports`)).exports); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Exports could not be loaded."); }
  }, [projectId]);
  useEffect(() => { let active = true; const timer = window.setTimeout(() => { if (active) void load(); }, 0); return () => { active = false; window.clearTimeout(timer); }; }, [load]);

  const latest = jobs?.[0] ?? null;
  const running = latest && ACTIVE.has(latest.status) ? latest : null;
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => { void load(); }, 1_500);
    return () => window.clearInterval(timer);
  }, [load, running]);

  async function startExport() {
    setBusy(true); setError(undefined);
    try { await request(`/api/projects/${projectId}/exports`, { method: "POST" }); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "This export could not be started."); }
    finally { setBusy(false); }
  }

  return <section className="export-manager">
    <div className="export-intro">
      <div>
        <h2>Download your website</h2>
        <p>Canvas checks your website, builds it as a standalone Next.js project, and packages it as a ZIP you can run or host anywhere. It contains only frontend code — no Canvas account, database, or backend.</p>
      </div>
      <div className="export-intro-actions">
        <Button type="button" onClick={() => void startExport()} disabled={busy || Boolean(running)}>
          {running ? <><LoaderCircle className="spin" size={15} />Exporting…</> : <><Package size={15} />Export website</>}
        </Button>
        <Button type="button" variant="ghost" onClick={() => void load()} aria-label="Refresh exports"><RefreshCw size={15} />Refresh</Button>
      </div>
    </div>
    {error ? <p className="history-inline-error" role="alert"><CircleAlert size={13} />{error}</p> : null}

    {jobs === null ? <p className="inline-empty"><LoaderCircle className="spin" size={13} /> Loading exports…</p>
      : jobs.length === 0 ? <div className="empty-state"><span className="state-icon"><Package size={22} /></span><h2>No exports yet</h2><p>Export your website when you are ready to run or host it yourself.</p></div>
      : <ul className="export-list">{jobs.map((job) => <li key={job.id} className={`export-row ${job.status}`}>
        <div className="export-row-main">
          <strong>{job.status === "completed" ? <><Check size={14} />Ready to download</> : job.status === "failed" ? <><CircleAlert size={14} />Not exported</> : <><LoaderCircle className="spin" size={14} />{job.progressStage}</>}</strong>
          <small>{when(job.createdAt)} · {job.actor}{job.artifact?.fileCount ? ` · ${job.artifact.fileCount} files · ${size(job.artifact.bytes)}` : ""}</small>
          {job.validation && job.validation.ok ? <span className="export-summary">{job.validation.pageCount} pages · {job.validation.blockCount} shared blocks · {job.validation.mediaCount} images</span> : null}
          {job.status === "failed" ? <span className="export-error">{job.errorMessage ?? "Canvas could not export this website."}</span> : null}
          {job.validation?.failures.length ? <details className="export-failures">
            <summary>What needs fixing ({job.validation.failures.length})</summary>
            <ul>{job.validation.failures.slice(0, 12).map((failure, index) => <li key={`${failure.code}-${index}`}><span>{failure.message}</span>{failure.entity ? <small>{failure.entity}</small> : null}</li>)}</ul>
          </details> : null}
          {job.validation?.checks.length && job.status === "completed" ? <details className="export-failures">
            <summary>Checks passed ({job.validation.checks.filter((check) => check.passed).length}/{job.validation.checks.length})</summary>
            <ul>{job.validation.checks.map((check) => <li key={check.name}><span>{check.passed ? "✓" : "✕"} {check.name}</span></li>)}</ul>
          </details> : null}
        </div>
        {job.status === "completed" ? <a className="button button-secondary" href={`/api/projects/${projectId}/exports/${job.id}/download`} download><Download size={14} />Download ZIP</a> : null}
      </li>)}</ul>}
  </section>;
}
