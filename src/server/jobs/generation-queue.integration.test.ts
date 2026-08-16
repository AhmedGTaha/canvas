import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { GenerationJobService, claimGenerationJobById } from "@/domain/ai/job-service";
import { AIFollowUpService } from "@/domain/ai-queue/service";
import { BuildingBlockService } from "@/domain/blocks/service";
import { PageTreeService } from "@/domain/pages/service";
import { ProjectService } from "@/domain/projects/service";
import { WorkspaceService } from "@/domain/workspaces/service";
import { db, sql } from "@/server/db/client";
import { generationJobs, users } from "@/server/db/schema";
import { executeGenerationJob, recoverStalledGenerationJobs, runClaimedGenerationJob, runGenerationWatchdog } from "./generation-execution";
import { GENERATION_JOB_TOPIC, WATCHDOG_DELAY_SECONDS, WATCHDOG_MAX_ROUNDS, setGenerationQueueTransport } from "@/server/queue/generation-queue";

type Published = { jobId: string; type: string; round?: number; idempotencyKey: string; delaySeconds: number };
const published: Published[] = [];
let transportError: Error | null = null;

async function setup() {
  const id = randomUUID();
  const [owner] = await db.insert(users).values({ id, email: `${id}@test.dev`, normalizedEmail: `${id}@test.dev`, displayName: "Owner" }).returning();
  const workspace = await new WorkspaceService().create(owner!.id, { name: "Workspace" });
  const project = await new ProjectService().create(owner!.id, { workspaceId: workspace.id, name: "Site" });
  const page = await new PageTreeService().create(owner!.id, { projectId: project.id, type: "page", name: "Home" });
  return { owner: owner!, project, page };
}

/** Drives a job to a terminal state the way the orchestration service would. */
function settleWith(status: "completed" | "failed" | "cancelled") {
  return async (jobId: string) => {
    await db.update(generationJobs).set({ status, progressStage: status, finishedAt: new Date() }).where(eq(generationJobs.id, jobId));
    return { status } as const;
  };
}

/** Mirrors a retryable provider failure: back to `queued` behind a backoff. */
function requeueAfter(seconds: number) {
  return async (jobId: string) => {
    await db.update(generationJobs).set({ status: "queued", progressStage: "Queued for retry", availableAt: new Date(Date.now() + seconds * 1_000), claimedAt: null, workerId: null, errorCode: "AI_PROVIDER_UNAVAILABLE" }).where(eq(generationJobs.id, jobId));
    return { status: "queued" } as const;
  };
}

// Every case writes through the real database, which is slower than the default budget.
describe.sequential("Vercel Queues generation dispatch", { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await sql`TRUNCATE TABLE ai_follow_up_queue, generation_job_media, page_versions, building_block_versions, building_blocks, ai_job_rate_limits, generation_jobs, ai_messages, ai_conversations, page_nodes, audit_events, project_members, projects, workspaces, users RESTART IDENTITY CASCADE`;
    published.length = 0;
    transportError = null;
    process.env.CANVAS_GENERATION_DISPATCH = "queue";
    setGenerationQueueTransport(async ({ message, idempotencyKey, delaySeconds }) => {
      if (transportError) throw transportError;
      published.push({ ...message, idempotencyKey, delaySeconds });
      return { messageId: `msg_${published.length}` };
    });
  });
  afterEach(() => { setGenerationQueueTransport(null); delete process.env.CANVAS_GENERATION_DISPATCH; });
  afterAll(async () => { await sql.end(); });

  /** Every dispatch also arms a delayed watchdog, so the two streams are read apart. */
  const executions = () => published.filter((message) => message.type === "execute");
  const watchdogs = () => published.filter((message) => message.type === "watchdog");

  it("publishes only the job id when a page job is created", async () => {
    const { owner, project, page } = await setup();
    const created = await new GenerationJobService().createPageJob(owner.id, { projectId: project.id, pageId: page.id, content: "Build it", selectedMediaIds: [] });
    expect(executions()).toEqual([{ jobId: created.job.id, type: "execute", idempotencyKey: `${created.job.id}:0`, delaySeconds: 0 }]);
    // Nothing but the pointer and a message type: no prompt, credential, or provider material.
    expect(Object.keys(published[0]!)).toEqual(["jobId", "type", "idempotencyKey", "delaySeconds"]);
    // The job arms its own recovery check instead of relying on a frequent cron.
    expect(watchdogs()).toEqual([{ jobId: created.job.id, type: "watchdog", round: 1, idempotencyKey: `${created.job.id}:0:watchdog:1`, delaySeconds: WATCHDOG_DELAY_SECONDS }]);
  });

  it("publishes a Building Block job and a promoted follow-up job", async () => {
    const { owner, project, page } = await setup();
    const block = await new BuildingBlockService().create(owner.id, { projectId: project.id, name: "Hero" });
    const blockJob = await new GenerationJobService().createBlockJob(owner.id, { projectId: project.id, blockId: block.id, content: "Make a hero", selectedMediaIds: [] });
    expect(executions().map((message) => message.jobId)).toEqual([blockJob.job.id]);

    const pageJob = await new GenerationJobService().createPageJob(owner.id, { projectId: project.id, pageId: page.id, content: "First", selectedMediaIds: [] });
    await new AIFollowUpService().create(owner.id, { projectId: project.id, targetType: "page", targetId: page.id, prompt: "Then this", selectedMediaIds: [] });
    published.length = 0;

    await executeGenerationJob(pageJob.job.id, { workerId: "queue:test", process: settleWith("completed") });
    // Completing the job promotes the follow-up, which publishes its own generation job.
    expect(executions()).toHaveLength(1);
    expect(executions()[0]!.jobId).not.toBe(pageJob.job.id);
  });

  it("records a publish failure and leaves the job recoverable instead of failing the request", async () => {
    const { owner, project, page } = await setup();
    transportError = new Error("queue unavailable");
    const created = await new GenerationJobService().createPageJob(owner.id, { projectId: project.id, pageId: page.id, content: "Build it", selectedMediaIds: [] });
    expect(published).toHaveLength(0);
    expect((await db.select().from(generationJobs).where(eq(generationJobs.id, created.job.id)))[0]).toMatchObject({ status: "queued" });

    transportError = null;
    await db.update(generationJobs).set({ availableAt: new Date(Date.now() - 120_000) }).where(eq(generationJobs.id, created.job.id));
    expect(await recoverStalledGenerationJobs()).toEqual({ candidates: 1, republished: 1 });
    expect(executions()[0]!.jobId).toBe(created.job.id);
  });

  it("claims a job exactly once across duplicate deliveries", async () => {
    const { owner, project, page } = await setup();
    const created = await new GenerationJobService().createPageJob(owner.id, { projectId: project.id, pageId: page.id, content: "Build it", selectedMediaIds: [] });

    const first = await claimGenerationJobById(created.job.id, "queue:first");
    const second = await claimGenerationJobById(created.job.id, "queue:second");
    expect(first?.id).toBe(created.job.id);
    expect(second).toBeNull();
    expect(first?.attemptCount).toBe(1);
  });

  it("treats a duplicate delivery of a running or finished job as a no-op", async () => {
    const { owner, project, page } = await setup();
    const created = await new GenerationJobService().createPageJob(owner.id, { projectId: project.id, pageId: page.id, content: "Build it", selectedMediaIds: [] });

    let runs = 0;
    const counted = async (jobId: string) => { runs += 1; return settleWith("completed")(jobId); };
    const processed = await executeGenerationJob(created.job.id, { workerId: "queue:one", process: counted });
    const duplicate = await executeGenerationJob(created.job.id, { workerId: "queue:two", process: counted });

    expect(processed).toEqual({ outcome: "processed", jobId: created.job.id, status: "completed" });
    expect(duplicate).toEqual({ outcome: "skipped", jobId: created.job.id, reason: "terminal" });
    expect(runs).toBe(1);
  });

  it("republishes a retryable failure with its backoff and stops at the attempt limit", async () => {
    const { owner, project, page } = await setup();
    const created = await new GenerationJobService().createPageJob(owner.id, { projectId: project.id, pageId: page.id, content: "Build it", selectedMediaIds: [] });
    published.length = 0;

    const result = await executeGenerationJob(created.job.id, { workerId: "queue:one", process: requeueAfter(4) });
    expect(result).toMatchObject({ outcome: "requeued", jobId: created.job.id });
    expect(executions()).toHaveLength(1);
    expect(executions()[0]).toMatchObject({ jobId: created.job.id, idempotencyKey: `${created.job.id}:1` });
    expect(executions()[0]!.delaySeconds).toBeGreaterThan(0);
    // The retry arms a watchdog past its own backoff, so a lost retry is still recovered.
    expect(watchdogs()[0]!.delaySeconds).toBeGreaterThan(WATCHDOG_DELAY_SECONDS);

    // A delivery that beats the backoff defers rather than running early.
    const early = await executeGenerationJob(created.job.id, { workerId: "queue:two", process: requeueAfter(4) });
    expect(early.outcome).toBe("deferred");

    await db.update(generationJobs).set({ attemptCount: 3, availableAt: new Date() }).where(eq(generationJobs.id, created.job.id));
    expect(await executeGenerationJob(created.job.id, { workerId: "queue:three", process: settleWith("completed") }))
      .toEqual({ outcome: "skipped", jobId: created.job.id, reason: "attempts_exhausted" });
  });

  it("never claims a job whose cancellation was requested", async () => {
    const { owner, project, page } = await setup();
    const created = await new GenerationJobService().createPageJob(owner.id, { projectId: project.id, pageId: page.id, content: "Build it", selectedMediaIds: [] });
    // Cancelling a queued job settles it immediately; force the mid-flight shape too.
    await db.update(generationJobs).set({ status: "generating", claimedAt: new Date(Date.now() - 600_000), cancelRequestedAt: new Date() }).where(eq(generationJobs.id, created.job.id));

    expect(await claimGenerationJobById(created.job.id, "queue:one")).toBeNull();
    expect(await executeGenerationJob(created.job.id, { workerId: "queue:one", process: settleWith("completed") }))
      .toEqual({ outcome: "skipped", jobId: created.job.id, reason: "cancel_requested" });
    expect(await recoverStalledGenerationJobs()).toEqual({ candidates: 0, republished: 0 });
  });

  it("recovers a job whose runner died mid-flight", async () => {
    const { owner, project, page } = await setup();
    const created = await new GenerationJobService().createPageJob(owner.id, { projectId: project.id, pageId: page.id, content: "Build it", selectedMediaIds: [] });
    await db.update(generationJobs).set({ status: "generating", attemptCount: 1, claimedAt: new Date(Date.now() - 600_000) }).where(eq(generationJobs.id, created.job.id));
    published.length = 0;

    expect(await recoverStalledGenerationJobs()).toEqual({ candidates: 1, republished: 1 });
    expect(executions()[0]!.idempotencyKey.startsWith(`${created.job.id}:1:r`)).toBe(true);
    // The stale claim is takeable, and the takeover counts as the next attempt.
    const taken = await executeGenerationJob(created.job.id, { workerId: "queue:recovered", process: settleWith("completed") });
    expect(taken).toEqual({ outcome: "processed", jobId: created.job.id, status: "completed" });
  });

  it("publishes nothing in worker dispatch mode", async () => {
    const { owner, project, page } = await setup();
    process.env.CANVAS_GENERATION_DISPATCH = "worker";
    const created = await new GenerationJobService().createPageJob(owner.id, { projectId: project.id, pageId: page.id, content: "Build it", selectedMediaIds: [] });
    expect(published).toHaveLength(0);
    // The local worker path claims and runs the same shared execution.
    const claimed = await claimGenerationJobById(created.job.id, "worker:local");
    expect(claimed).not.toBeNull();
    expect(await runClaimedGenerationJob(created.job.id, { process: settleWith("completed") }))
      .toEqual({ outcome: "processed", jobId: created.job.id, status: "completed" });
  });

  it("recovers a failed initial publish through the job's own watchdog, without a cron", async () => {
    const { owner, project, page } = await setup();
    transportError = new Error("queue unavailable");
    const created = await new GenerationJobService().createPageJob(owner.id, { projectId: project.id, pageId: page.id, content: "Build it", selectedMediaIds: [] });
    expect(published).toHaveLength(0);

    transportError = null;
    // The delayed check would arrive about five minutes later; the job is due by then.
    await db.update(generationJobs).set({ availableAt: new Date(Date.now() - 300_000) }).where(eq(generationJobs.id, created.job.id));
    expect(await runGenerationWatchdog(created.job.id, 1)).toMatchObject({ verdict: "republished" });
    expect(executions().map((message) => message.jobId)).toEqual([created.job.id]);
    // And it arms the next check, so a lost republish is caught too.
    expect(watchdogs()[0]).toMatchObject({ jobId: created.job.id, round: 2 });
  });

  it("no-ops when the job finished, failed, was cancelled, or is actively claimed", async () => {
    const { owner, project, page } = await setup();
    const created = await new GenerationJobService().createPageJob(owner.id, { projectId: project.id, pageId: page.id, content: "Build it", selectedMediaIds: [] });

    for (const status of ["completed", "failed", "cancelled"] as const) {
      await db.update(generationJobs).set({ status, finishedAt: new Date() }).where(eq(generationJobs.id, created.job.id));
      published.length = 0;
      expect(await runGenerationWatchdog(created.job.id, 1)).toMatchObject({ verdict: "settled", reason: "terminal" });
      expect(published).toHaveLength(0);
    }

    // A cancellation that has not been observed yet is equally hands-off.
    await db.update(generationJobs).set({ status: "generating", finishedAt: null, cancelRequestedAt: new Date(), claimedAt: new Date(Date.now() - 600_000) }).where(eq(generationJobs.id, created.job.id));
    published.length = 0;
    expect(await runGenerationWatchdog(created.job.id, 1)).toMatchObject({ verdict: "settled", reason: "cancel_requested" });
    expect(published).toHaveLength(0);

    // A live claim belongs to whoever holds it: check again later, republish nothing.
    await db.update(generationJobs).set({ status: "generating", cancelRequestedAt: null, claimedAt: new Date() }).where(eq(generationJobs.id, created.job.id));
    published.length = 0;
    expect(await runGenerationWatchdog(created.job.id, 1)).toMatchObject({ verdict: "healthy", reason: "in_flight" });
    expect(executions()).toHaveLength(0);
    expect(watchdogs()).toHaveLength(1);

    // A job whose attempts are spent is left for the daily maintenance sweep to fail.
    await db.update(generationJobs).set({ status: "queued", attemptCount: 3, availableAt: new Date(Date.now() - 600_000) }).where(eq(generationJobs.id, created.job.id));
    published.length = 0;
    expect(await runGenerationWatchdog(created.job.id, 1)).toMatchObject({ verdict: "settled", reason: "attempts_exhausted" });
    expect(published).toHaveLength(0);
  });

  it("takes over a dead runner exactly once and never runs a generation twice", async () => {
    const { owner, project, page } = await setup();
    const created = await new GenerationJobService().createPageJob(owner.id, { projectId: project.id, pageId: page.id, content: "Build it", selectedMediaIds: [] });
    await db.update(generationJobs).set({ status: "generating", attemptCount: 1, claimedAt: new Date(Date.now() - 600_000) }).where(eq(generationJobs.id, created.job.id));
    published.length = 0;

    expect(await runGenerationWatchdog(created.job.id, 2)).toMatchObject({ verdict: "republished", round: 2 });
    expect(executions()[0]!.idempotencyKey).toBe(`${created.job.id}:1:w2`);

    let runs = 0;
    const counted = async (jobId: string) => { runs += 1; return settleWith("completed")(jobId); };
    const first = await executeGenerationJob(created.job.id, { workerId: "queue:takeover", process: counted });
    // The republished message is at-least-once, so the duplicate is the normal case.
    const duplicate = await executeGenerationJob(created.job.id, { workerId: "queue:duplicate", process: counted });
    expect(first).toEqual({ outcome: "processed", jobId: created.job.id, status: "completed" });
    expect(duplicate).toEqual({ outcome: "skipped", jobId: created.job.id, reason: "terminal" });
    expect(runs).toBe(1);
  });

  it("bounds the watchdog chain instead of rescheduling forever", async () => {
    const { owner, project, page } = await setup();
    const created = await new GenerationJobService().createPageJob(owner.id, { projectId: project.id, pageId: page.id, content: "Build it", selectedMediaIds: [] });
    await db.update(generationJobs).set({ status: "generating", claimedAt: new Date() }).where(eq(generationJobs.id, created.job.id));
    published.length = 0;

    expect(await runGenerationWatchdog(created.job.id, WATCHDOG_MAX_ROUNDS)).toMatchObject({ verdict: "exhausted" });
    expect(published).toHaveLength(0);
  });

  it("registers the consumer as a queue-triggered function in vercel.json", async () => {
    const config = JSON.parse(await readFile(new URL("../../../vercel.json", import.meta.url), "utf8")) as {
      functions: Record<string, { maxDuration?: number; experimentalTriggers?: { type: string; topic: string }[] }>;
      crons: { path: string; schedule: string }[];
    };
    const consumer = config.functions["src/app/api/queues/generation-jobs/route.ts"];
    expect(consumer?.experimentalTriggers).toEqual([expect.objectContaining({ type: "queue/v2beta", topic: GENERATION_JOB_TOPIC })]);
    // 300s is the Hobby maximum for a fluid-compute Node.js function.
    expect(consumer?.maxDuration).toBe(300);
    expect(config.crons.map((cron) => cron.path)).toContain("/api/cron/generation-maintenance");
    // Hobby allows at most one run per day, so no schedule may name a minute or hour step.
    for (const cron of config.crons) {
      const [minute, hour] = cron.schedule.split(" ");
      expect(minute).toMatch(/^\d+$/);
      expect(hour).toMatch(/^\d+$/);
    }
  });
});
