import { beforeEach, describe, expect, it, vi } from "vitest";
import { exportActive, exportNotFound, exportNotReady, exportValidationFailed } from "@/domain/export/errors";

const currentUser = vi.hoisted(() => vi.fn());
const create = vi.hoisted(() => vi.fn());
const list = vi.hoisted(() => vi.fn());
const get = vi.hoisted(() => vi.fn());
const download = vi.hoisted(() => vi.fn());
vi.mock("@/server/auth/session", () => ({ getCurrentUser: currentUser, requireAuthenticatedUser: currentUser }));
vi.mock("@/domain/export/export-service", () => ({ ExportService: class { create = create; list = list; get = get; download = download; } }));

const { GET: listGet, POST: createPost } = await import("@/app/api/projects/[projectId]/exports/route");
const { GET: detailGet } = await import("@/app/api/projects/[projectId]/exports/[exportId]/route");
const { GET: downloadGet } = await import("@/app/api/projects/[projectId]/exports/[exportId]/download/route");

const userId = "00000000-0000-4000-8000-0000000000ff";
const projectId = "00000000-0000-4000-8000-000000000001";
const exportId = "00000000-0000-4000-8000-000000000002";
const request = (method = "GET") => new Request("http://localhost/api", { method });
const params = Promise.resolve({ projectId, exportId });

describe("export routes", () => {
  beforeEach(() => { vi.clearAllMocks(); currentUser.mockResolvedValue({ id: userId }); });

  it("scopes every operation to the authenticated user and project", async () => {
    list.mockResolvedValue([]); create.mockResolvedValue({ id: exportId, status: "queued", progressStage: "Queued" }); get.mockResolvedValue({ id: exportId, status: "completed" });
    expect((await listGet(request(), { params: Promise.resolve({ projectId }) })).status).toBe(200);
    expect(list).toHaveBeenCalledWith(userId, projectId);
    expect((await createPost(request("POST"), { params: Promise.resolve({ projectId }) })).status).toBe(201);
    expect(create).toHaveBeenCalledWith(userId, projectId);
    expect((await detailGet(request(), { params })).status).toBe(200);
    expect(get).toHaveBeenCalledWith(userId, projectId, exportId);
  });

  it("streams a completed archive as an attachment without leaking storage details", async () => {
    download.mockResolvedValue({ bytes: new Uint8Array([1, 2, 3, 4]), fileName: "acme site.zip" });
    const response = await downloadGet(request(), { params });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="acme-site.zip"');
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(download).toHaveBeenCalledWith(userId, projectId, exportId);
  });

  it("returns normalized export error codes with their statuses", async () => {
    download.mockRejectedValue(exportNotReady());
    const notReady = await downloadGet(request(), { params });
    expect(notReady.status).toBe(409);
    expect(await notReady.json()).toMatchObject({ code: "EXPORT_NOT_READY" });

    get.mockRejectedValue(exportNotFound());
    const notFound = await detailGet(request(), { params });
    expect(notFound.status).toBe(404);
    expect(await notFound.json()).toMatchObject({ code: "EXPORT_NOT_FOUND" });

    create.mockRejectedValue(exportActive());
    const active = await createPost(request("POST"), { params: Promise.resolve({ projectId }) });
    expect(active.status).toBe(409);
    expect(await active.json()).toMatchObject({ code: "EXPORT_ACTIVE" });

    create.mockRejectedValue(exportValidationFailed([{ code: "MEDIA_MISSING", message: "An image is missing." }]));
    const invalid = await createPost(request("POST"), { params: Promise.resolve({ projectId }) });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ code: "EXPORT_VALIDATION_FAILED", failures: [{ code: "MEDIA_MISSING" }] });
  });

  it("rejects unauthenticated export requests before reaching the domain", async () => {
    currentUser.mockResolvedValue(null);
    for (const call of [
      listGet(request(), { params: Promise.resolve({ projectId }) }),
      createPost(request("POST"), { params: Promise.resolve({ projectId }) }),
      detailGet(request(), { params }),
      downloadGet(request(), { params }),
    ]) expect((await call).status).toBe(401);
    for (const service of [create, list, get, download]) expect(service).not.toHaveBeenCalled();
  });
});
