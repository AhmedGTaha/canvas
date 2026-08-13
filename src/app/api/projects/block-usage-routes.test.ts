import { beforeEach, describe, expect, it, vi } from "vitest";
import { blockUsageNotFound } from "@/domain/blocks/errors";

const currentUser = vi.hoisted(() => vi.fn());
const listUsages = vi.hoisted(() => vi.fn());
const setUsageResolution = vi.hoisted(() => vi.fn());
vi.mock("@/server/auth/session", () => ({ getCurrentUser: currentUser, requireAuthenticatedUser: currentUser }));
vi.mock("@/domain/blocks/service", () => ({ BuildingBlockService: class { listUsages = listUsages; setUsageResolution = setUsageResolution; } }));

const { GET: usagesGet } = await import("@/app/api/projects/[projectId]/blocks/[blockId]/usages/route");
const { PATCH: usagePatch } = await import("@/app/api/projects/[projectId]/blocks/[blockId]/usages/[usageKey]/route");

const userId = "00000000-0000-4000-8000-0000000000ff";
const projectId = "00000000-0000-4000-8000-000000000001";
const blockId = "00000000-0000-4000-8000-000000000003";
const pageId = "00000000-0000-4000-8000-000000000002";
function patch(body: unknown) { return new Request("http://localhost/api", { method: "PATCH", body: JSON.stringify(body) }); }

describe("Building Block usage routes", () => {
  beforeEach(() => { vi.clearAllMocks(); currentUser.mockResolvedValue({ id: userId }); });

  it("lists a block's usages for the signed-in user", async () => {
    listUsages.mockResolvedValue([{ usageKey: "site-navbar", pageId, pageName: "Home", route: "/", pinnedVersionId: null, resolution: "global" }]);
    const response = await usagesGet(new Request("http://localhost/api"), { params: Promise.resolve({ projectId, blockId }) });
    expect(response.status).toBe(200);
    expect(listUsages).toHaveBeenCalledWith(userId, projectId, blockId);
  });

  /*
   * A usage key is unique per page, not per block, so the page has to travel
   * with it — otherwise detaching one page would detach every page using the
   * block under the same key.
   */
  it("scopes a resolution change to one page's usage", async () => {
    setUsageResolution.mockResolvedValue({ usageKey: "site-navbar", pageId, resolution: "pinned" });
    const response = await usagePatch(patch({ pageId, resolution: "pinned" }), { params: Promise.resolve({ projectId, blockId, usageKey: "site-navbar" }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ usage: { usageKey: "site-navbar", pageId, resolution: "pinned" } });
    expect(setUsageResolution).toHaveBeenCalledWith(userId, { projectId, blockId, pageId, usageKey: "site-navbar", resolution: "pinned" });
  });

  it("decodes a usage key that had to be escaped in the path", async () => {
    setUsageResolution.mockResolvedValue({ usageKey: "hero/top", pageId, resolution: "global" });
    await usagePatch(patch({ pageId, resolution: "global" }), { params: Promise.resolve({ projectId, blockId, usageKey: "hero%2Ftop" }) });
    expect(setUsageResolution).toHaveBeenCalledWith(userId, expect.objectContaining({ usageKey: "hero/top" }));
  });

  it("requires a signed-in user before reaching the service", async () => {
    currentUser.mockResolvedValue(null);
    const response = await usagePatch(patch({ pageId, resolution: "pinned" }), { params: Promise.resolve({ projectId, blockId, usageKey: "site-navbar" }) });
    expect(response.status).toBe(401);
    expect(setUsageResolution).not.toHaveBeenCalled();
  });

  it("reports a usage that is no longer there without leaking anything else", async () => {
    setUsageResolution.mockRejectedValue(blockUsageNotFound());
    const response = await usagePatch(patch({ pageId, resolution: "pinned" }), { params: Promise.resolve({ projectId, blockId, usageKey: "site-navbar" }) });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "This page no longer uses that section." });
  });
});
