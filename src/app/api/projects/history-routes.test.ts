import { beforeEach, describe, expect, it, vi } from "vitest";
import { undoConflict, versionNotFound } from "@/domain/history/errors";

const currentUser = vi.hoisted(() => vi.fn());
const undo = vi.hoisted(() => vi.fn());
const redo = vi.hoisted(() => vi.fn());
const historyState = vi.hoisted(() => vi.fn());
const restorePageVersion = vi.hoisted(() => vi.fn());
const listPageVersions = vi.hoisted(() => vi.fn());
const restoreBlockVersion = vi.hoisted(() => vi.fn());
const createCheckpoint = vi.hoisted(() => vi.fn());
const restoreCheckpoint = vi.hoisted(() => vi.fn());

vi.mock("@/server/auth/session", () => ({ getCurrentUser: currentUser, requireAuthenticatedUser: currentUser }));
vi.mock("@/domain/history/undo-service", () => ({ HistoryService: class { undo = undo; redo = redo; state = historyState; } }));
vi.mock("@/domain/history/restore-service", () => ({ VersionRestoreService: class { restorePageVersion = restorePageVersion; listPageVersions = listPageVersions; restoreBlockVersion = restoreBlockVersion; listBlockVersions = vi.fn(); } }));
vi.mock("@/domain/history/checkpoint-service", () => ({ CheckpointService: class { create = createCheckpoint; list = vi.fn(); restore = restoreCheckpoint; } }));

const { GET: historyGet } = await import("@/app/api/projects/[projectId]/history/route");
const { POST: undoPost } = await import("@/app/api/projects/[projectId]/history/undo/route");
const { POST: redoPost } = await import("@/app/api/projects/[projectId]/history/redo/route");
const { GET: versionsGet } = await import("@/app/api/projects/[projectId]/pages/[pageId]/versions/route");
const { POST: pageRestorePost } = await import("@/app/api/projects/[projectId]/pages/[pageId]/versions/[versionId]/restore/route");
const { POST: blockRestorePost } = await import("@/app/api/projects/[projectId]/blocks/[blockId]/versions/[versionId]/restore/route");
const { POST: checkpointPost } = await import("@/app/api/projects/[projectId]/checkpoints/route");
const { POST: checkpointRestorePost } = await import("@/app/api/projects/[projectId]/checkpoints/[checkpointId]/restore/route");

const userId = "00000000-0000-4000-8000-0000000000ff";
const projectId = "00000000-0000-4000-8000-000000000001";
const pageId = "00000000-0000-4000-8000-000000000002";
const blockId = "00000000-0000-4000-8000-000000000003";
const versionId = "00000000-0000-4000-8000-000000000004";
const checkpointId = "00000000-0000-4000-8000-000000000005";
const post = (body?: unknown) => new Request("http://localhost/api", { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
const get = () => new Request("http://localhost/api");

describe("history, version, and checkpoint routes", () => {
  beforeEach(() => { vi.clearAllMocks(); currentUser.mockResolvedValue({ id: userId }); });

  it("passes the authenticated user and route scope to the history services", async () => {
    historyState.mockResolvedValue({ undo: null, redo: null, history: [] });
    undo.mockResolvedValue({ changeSet: { id: "cs", summary: "Undid: x" }, source: { id: "src", summary: "x" } });
    redo.mockResolvedValue({ changeSet: { id: "cs", summary: "Redid: x" }, source: { id: "src", summary: "x" } });
    listPageVersions.mockResolvedValue({ currentVersionId: versionId, versions: [] });
    restorePageVersion.mockResolvedValue({ changeSet: { id: "cs" }, version: { id: versionId, versionNumber: 2 } });
    restoreBlockVersion.mockResolvedValue({ changeSet: { id: "cs" }, version: { id: versionId, versionNumber: 3 } });
    createCheckpoint.mockResolvedValue({ id: checkpointId, name: "Before rework" });
    restoreCheckpoint.mockResolvedValue({ changeSet: { id: "cs" }, checkpoint: { name: "Before rework" }, restored: { pages: 2, blocks: 1 }, skipped: [] });

    expect((await historyGet(get(), { params: Promise.resolve({ projectId }) })).status).toBe(200);
    expect(historyState).toHaveBeenCalledWith(userId, projectId);
    expect((await undoPost(post(), { params: Promise.resolve({ projectId }) })).status).toBe(200);
    expect(undo).toHaveBeenCalledWith(userId, projectId);
    expect((await redoPost(post(), { params: Promise.resolve({ projectId }) })).status).toBe(200);
    expect(redo).toHaveBeenCalledWith(userId, projectId);
    expect((await versionsGet(get(), { params: Promise.resolve({ projectId, pageId }) })).status).toBe(200);
    expect(listPageVersions).toHaveBeenCalledWith(userId, projectId, pageId);
    expect((await pageRestorePost(post(), { params: Promise.resolve({ projectId, pageId, versionId }) })).status).toBe(200);
    expect(restorePageVersion).toHaveBeenCalledWith(userId, projectId, pageId, versionId);
    expect((await blockRestorePost(post(), { params: Promise.resolve({ projectId, blockId, versionId }) })).status).toBe(200);
    expect(restoreBlockVersion).toHaveBeenCalledWith(userId, projectId, blockId, versionId);
    expect((await checkpointPost(post({ name: "Before rework" }), { params: Promise.resolve({ projectId }) })).status).toBe(201);
    expect(createCheckpoint).toHaveBeenCalledWith(userId, { projectId, name: "Before rework" });
    expect((await checkpointRestorePost(post(), { params: Promise.resolve({ projectId, checkpointId }) })).status).toBe(200);
    expect(restoreCheckpoint).toHaveBeenCalledWith(userId, projectId, checkpointId);
  });

  it("returns normalized history error codes with correct statuses", async () => {
    undo.mockRejectedValue(undoConflict());
    const conflict = await undoPost(post(), { params: Promise.resolve({ projectId }) });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: "UNDO_CONFLICT", error: expect.stringContaining("newer changes") });

    restorePageVersion.mockRejectedValue(versionNotFound());
    const missing = await pageRestorePost(post(), { params: Promise.resolve({ projectId, pageId, versionId }) });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ code: "VERSION_NOT_FOUND" });
  });

  it("rejects unauthenticated history requests before reaching the domain", async () => {
    currentUser.mockResolvedValue(null);
    for (const call of [
      historyGet(get(), { params: Promise.resolve({ projectId }) }),
      undoPost(post(), { params: Promise.resolve({ projectId }) }),
      redoPost(post(), { params: Promise.resolve({ projectId }) }),
      versionsGet(get(), { params: Promise.resolve({ projectId, pageId }) }),
      pageRestorePost(post(), { params: Promise.resolve({ projectId, pageId, versionId }) }),
      blockRestorePost(post(), { params: Promise.resolve({ projectId, blockId, versionId }) }),
      checkpointPost(post({ name: "x" }), { params: Promise.resolve({ projectId }) }),
      checkpointRestorePost(post(), { params: Promise.resolve({ projectId, checkpointId }) }),
    ]) expect((await call).status).toBe(401);
    for (const service of [undo, redo, historyState, restorePageVersion, listPageVersions, restoreBlockVersion, createCheckpoint, restoreCheckpoint]) expect(service).not.toHaveBeenCalled();
  });
});
