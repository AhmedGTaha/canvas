import { beforeEach, describe, expect, it, vi } from "vitest";

const objects = new Map<string, Uint8Array>();

vi.mock("@vercel/blob", () => ({
  BlobNotFoundError: class BlobNotFoundError extends Error {},
  put: vi.fn(async (key: string, bytes: Uint8Array) => { objects.set(key, new Uint8Array(bytes)); }),
  get: vi.fn(async (key: string) => {
    const bytes = objects.get(key);
    return bytes ? { statusCode: 200, stream: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } }) } : null;
  }),
  head: vi.fn(async (key: string) => {
    if (!objects.has(key)) throw new (class BlobNotFoundError extends Error {})();
    return { pathname: key };
  }),
  del: vi.fn(async (key: string) => { objects.delete(key); }),
}));

import { VercelBlobObjectStorage } from "./vercel-blob-object-storage";

describe("VercelBlobObjectStorage", () => {
  beforeEach(() => { objects.clear(); });

  it("persists private objects across independent adapter instances", async () => {
    const first = new VercelBlobObjectStorage();
    await first.put("exports/project/export.zip", new Uint8Array([1, 2, 3]));
    const second = new VercelBlobObjectStorage();
    await expect(second.get("exports/project/export.zip")).resolves.toEqual(new Uint8Array([1, 2, 3]));
    await expect(second.exists("exports/project/export.zip")).resolves.toBe(true);
  });

  it("does not accept paths outside the ObjectStorage key contract", async () => {
    await expect(new VercelBlobObjectStorage().put("../archive.zip", new Uint8Array([1]))).rejects.toThrow("Invalid object storage key");
  });
});
