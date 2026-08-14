/**
 * One vocabulary for "is anything happening to this website right now".
 *
 * The status bar, the title bar, the preview's live region and the agent used
 * to answer that question separately: the footer said "Website up to date"
 * while a job was running, the preview still offered to build a page that was
 * being built, and the agent read out the server's own stage names. They now
 * all derive their words from here, so the three places a person looks agree.
 */
export type WorkPhase = "idle" | "building" | "checking" | "saving" | "loading" | "error";

/** Job statuses that mean the agent is working. Ordered as the job runs. */
export const ACTIVE_JOB_STATUSES = ["queued", "preparing_context", "generating", "validating", "applying"] as const;
export function isActiveJobStatus(status: string | undefined): boolean {
  return Boolean(status) && (ACTIVE_JOB_STATUSES as readonly string[]).includes(status!);
}

export function workPhase({ jobStatus, previewStatus }: { jobStatus?: string; previewStatus: "loading" | "ready" | "error" }): WorkPhase {
  if (jobStatus === "validating") return "checking";
  if (jobStatus === "applying") return "saving";
  if (isActiveJobStatus(jobStatus)) return "building";
  if (previewStatus === "error") return "error";
  if (previewStatus === "loading") return "loading";
  return "idle";
}

/** The full sentence, for the status bar and the preview's live region. */
export function workLabel(phase: WorkPhase): string {
  switch (phase) {
    case "building": return "Building your website…";
    case "checking": return "Checking the changes…";
    case "saving": return "Saving the changes…";
    case "loading": return "Loading the website…";
    case "error": return "Preview unavailable";
    default: return "Website up to date";
  }
}

/** The same state where a job is the only thing worth reporting. */
export function jobLabel(jobStatus: string | undefined, fallback: string): string {
  const phase = workPhase({ jobStatus, previewStatus: "ready" });
  return phase === "idle" ? fallback : workLabel(phase);
}

export function isWorking(phase: WorkPhase): boolean {
  return phase === "building" || phase === "checking" || phase === "saving";
}
