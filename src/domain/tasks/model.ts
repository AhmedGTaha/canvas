export type ProjectTask = {
  id: string; type: "generation" | "export"; target: string; status: "active" | "failed" | "cancelled" | "completed";
  stage: string; initiator: string; startedAt: Date; completedAt: Date | null; summary: string | null;
  action: { kind: "review" | "export" | "retry" | "reopen"; id: string } | null;
};

const activeGeneration = new Set(["queued", "preparing_context", "generating", "validating", "applying"]);
const activeExport = new Set(["queued", "validating", "assembling", "building", "packaging"]);
export function taskStatus(type: "generation" | "export", status: string): ProjectTask["status"] {
  if ((type === "generation" ? activeGeneration : activeExport).has(status)) return "active";
  if (status === "completed") return "completed";
  if (status === "cancelled") return "cancelled";
  return "failed";
}

export function safeTaskStage(status: ProjectTask["status"], stage: string) {
  if (status === "failed") return "Needs attention";
  if (status === "cancelled") return "Cancelled";
  if (status === "completed") return "Completed";
  const labels: Record<string, string> = { queued: "Waiting to start", preparing_context: "Preparing your website", generating: "Creating the update", validating: "Checking the update", applying: "Saving the update", assembling: "Preparing project files", building: "Checking the website", packaging: "Preparing the download" };
  return labels[stage.toLowerCase().replace(/\s+/g, "_")] ?? stage;
}
