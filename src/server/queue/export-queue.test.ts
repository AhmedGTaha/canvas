import { afterEach, describe, expect, it } from "vitest";
import { dispatchExportJob, exportDispatchMode, setExportQueueTransport } from "./export-queue";

const originalVercel = process.env.VERCEL;
const originalDispatch = process.env.CANVAS_EXPORT_DISPATCH;

afterEach(() => {
  setExportQueueTransport(null);
  if (originalVercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = originalVercel;
  if (originalDispatch === undefined) delete process.env.CANVAS_EXPORT_DISPATCH; else process.env.CANVAS_EXPORT_DISPATCH = originalDispatch;
});

describe("export queue dispatch", () => {
  it("uses the worker locally and publishes only a job pointer on Vercel", async () => {
    delete process.env.VERCEL;
    delete process.env.CANVAS_EXPORT_DISPATCH;
    expect(exportDispatchMode()).toBe("worker");
    await expect(dispatchExportJob({ jobId: "df4a5e8f-6df7-45d8-8d1b-4b613ac1fbe4", projectId: "project", attempt: 0, reason: "created" })).resolves.toEqual({ mode: "worker", published: false });

    process.env.VERCEL = "1";
    const messages: unknown[] = [];
    setExportQueueTransport(async (input) => { messages.push(input); return { messageId: "message" }; });
    await dispatchExportJob({ jobId: "df4a5e8f-6df7-45d8-8d1b-4b613ac1fbe4", projectId: "project", attempt: 0, reason: "created" });
    expect(messages).toEqual([
      { message: { jobId: "df4a5e8f-6df7-45d8-8d1b-4b613ac1fbe4", type: "execute" }, idempotencyKey: "df4a5e8f-6df7-45d8-8d1b-4b613ac1fbe4:0", delaySeconds: 0 },
      { message: { jobId: "df4a5e8f-6df7-45d8-8d1b-4b613ac1fbe4", type: "watchdog", round: 1 }, idempotencyKey: "df4a5e8f-6df7-45d8-8d1b-4b613ac1fbe4:0:watchdog:1", delaySeconds: 300 },
    ]);
  });

  it("keeps a committed job recoverable when initial queue publishing fails", async () => {
    process.env.CANVAS_EXPORT_DISPATCH = "queue";
    setExportQueueTransport(async () => { throw new Error("queue unavailable"); });
    await expect(dispatchExportJob({ jobId: "df4a5e8f-6df7-45d8-8d1b-4b613ac1fbe4", projectId: "project", attempt: 0, reason: "created" }))
      .resolves.toMatchObject({ mode: "queue", published: false });
  });
});
