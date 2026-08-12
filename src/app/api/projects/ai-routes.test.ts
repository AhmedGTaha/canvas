import { beforeEach, describe, expect, it, vi } from "vitest";
import { AIError } from "@/domain/ai/provider";

const currentUser = vi.hoisted(() => vi.fn());
const createPageJob = vi.hoisted(() => vi.fn());
const createBlockJob = vi.hoisted(() => vi.fn());
vi.mock("@/server/auth/session", () => ({ getCurrentUser: currentUser, requireAuthenticatedUser: currentUser }));
vi.mock("@/domain/ai/job-service", () => ({ GenerationJobService: class { createPageJob = createPageJob; createBlockJob = createBlockJob; } }));

const { POST: pagePost } = await import("@/app/api/projects/[projectId]/pages/[pageId]/ai/route");
const { POST: blockPost } = await import("@/app/api/projects/[projectId]/blocks/[blockId]/ai/route");

const projectId = "00000000-0000-4000-8000-000000000001";
const pageId = "00000000-0000-4000-8000-000000000002";
const blockId = "00000000-0000-4000-8000-000000000003";
const selection = { canvasId: "pricing-card-pro", blockId: null, usageKey: null };
function post(body: unknown) { return new Request("http://localhost/api", { method: "POST", body: JSON.stringify(body) }); }

describe("targeted AI request routes", () => {
  beforeEach(() => { vi.clearAllMocks(); currentUser.mockResolvedValue({ id: "00000000-0000-4000-8000-0000000000ff" }); });

  it("forwards the selected element to the page job service", async () => {
    createPageJob.mockResolvedValue({ job: { id: "job" } });
    const response = await pagePost(post({ content: "Make this card more compact", selectedMediaIds: [], selection }), { params: Promise.resolve({ projectId, pageId }) });
    expect(response.status).toBe(201);
    expect(createPageJob).toHaveBeenCalledWith("00000000-0000-4000-8000-0000000000ff", expect.objectContaining({ projectId, pageId, selection }));
  });

  it("forwards the selected element to the Building Block job service", async () => {
    createBlockJob.mockResolvedValue({ job: { id: "job" } });
    const response = await blockPost(post({ content: "Tighten the navbar", selection: { canvasId: "navbar-root", blockId, usageKey: null } }), { params: Promise.resolve({ projectId, blockId }) });
    expect(response.status).toBe(201);
    expect(createBlockJob).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ projectId, blockId, selection: { canvasId: "navbar-root", blockId, usageKey: null } }));
  });

  it("defaults to no selection when the client omits one", async () => {
    createPageJob.mockResolvedValue({ job: { id: "job" } });
    await pagePost(post({ content: "Rebuild the page" }), { params: Promise.resolve({ projectId, pageId }) });
    expect(createPageJob).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ selection: null }));
  });

  it("returns normalized element error codes without leaking internals", async () => {
    createPageJob.mockRejectedValue(new AIError("AI_ELEMENT_NOT_FOUND", "That selection is no longer part of this page. Select the element again.", false, undefined, "internal diagnostic"));
    const response = await pagePost(post({ content: "Edit", selection }), { params: Promise.resolve({ projectId, pageId }) });
    expect(response.status).toBe(400);
    const body = await response.json() as { error: string; code: string };
    expect(body).toEqual({ error: "That selection is no longer part of this page. Select the element again.", code: "AI_ELEMENT_NOT_FOUND" });

    createBlockJob.mockRejectedValue(new AIError("AI_ELEMENT_INVALID", "That element belongs to a different Building Block."));
    const blockResponse = await blockPost(post({ content: "Edit", selection: { canvasId: "navbar-root" } }), { params: Promise.resolve({ projectId, blockId }) });
    expect(blockResponse.status).toBe(400);
    expect(await blockResponse.json()).toMatchObject({ code: "AI_ELEMENT_INVALID" });
  });

  it("rejects unauthenticated targeted requests before reaching the domain", async () => {
    currentUser.mockResolvedValue(null);
    expect((await pagePost(post({ content: "Edit", selection }), { params: Promise.resolve({ projectId, pageId }) })).status).toBe(401);
    expect((await blockPost(post({ content: "Edit" }), { params: Promise.resolve({ projectId, blockId }) })).status).toBe(401);
    expect(createPageJob).not.toHaveBeenCalled();
    expect(createBlockJob).not.toHaveBeenCalled();
  });
});
