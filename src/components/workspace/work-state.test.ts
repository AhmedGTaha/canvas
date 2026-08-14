import { describe, expect, it } from "vitest";
import { isWorking, jobLabel, workLabel, workPhase } from "./work-state";

describe("workspace work state", () => {
  it("reports the agent's work ahead of the preview's own loading", () => {
    // A running job is the answer even while the frame is reloading under it.
    expect(workPhase({ jobStatus: "generating", previewStatus: "loading" })).toBe("building");
    expect(workPhase({ jobStatus: "validating", previewStatus: "ready" })).toBe("checking");
    expect(workPhase({ jobStatus: "applying", previewStatus: "ready" })).toBe("saving");
    expect(workPhase({ jobStatus: "queued", previewStatus: "ready" })).toBe("building");
  });

  it("falls back to the preview when nothing is being generated", () => {
    expect(workPhase({ previewStatus: "loading" })).toBe("loading");
    expect(workPhase({ previewStatus: "error" })).toBe("error");
    expect(workPhase({ previewStatus: "ready" })).toBe("idle");
    expect(workPhase({ jobStatus: "completed", previewStatus: "ready" })).toBe("idle");
    expect(workPhase({ jobStatus: "failed", previewStatus: "ready" })).toBe("idle");
  });

  it("never says the website is up to date while work is running", () => {
    for (const status of ["queued", "preparing_context", "generating", "validating", "applying"]) {
      const phase = workPhase({ jobStatus: status, previewStatus: "ready" });
      expect(isWorking(phase)).toBe(true);
      expect(workLabel(phase)).not.toBe("Website up to date");
    }
    expect(workLabel(workPhase({ previewStatus: "ready" }))).toBe("Website up to date");
  });

  it("gives the agent the same words as the status bar, and keeps a fallback", () => {
    expect(jobLabel("generating", "Generating page")).toBe(workLabel("building"));
    expect(jobLabel("validating", "Validating page")).toBe(workLabel("checking"));
    // A stage the client does not know about is still worth showing verbatim.
    expect(jobLabel("completed", "Completed")).toBe("Completed");
  });
});
