import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalObjectStorage } from "./local-object-storage";

const roots: string[] = [];

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("local object storage", () => {
  it("writes, reads, and deletes private objects", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "canvas-media-")); roots.push(root);
    const storage = new LocalObjectStorage(root);
    const bytes = new Uint8Array([1, 2, 3]);
    await storage.put("projects/project/media/asset/original.png", bytes);
    await expect(storage.exists("projects/project/media/asset/original.png")).resolves.toBe(true);
    await expect(storage.get("projects/project/media/asset/original.png")).resolves.toEqual(Buffer.from(bytes));
    await expect(readFile(path.join(root, "projects/project/media/asset/original.png"))).resolves.toEqual(Buffer.from(bytes));
    await storage.delete("projects/project/media/asset/original.png");
    await expect(storage.exists("projects/project/media/asset/original.png")).resolves.toBe(false);
    await expect(storage.get("projects/project/media/asset/original.png")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects traversal and absolute storage keys", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "canvas-media-")); roots.push(root);
    const storage = new LocalObjectStorage(root);
    await expect(storage.put("../escape", new Uint8Array([1]))).rejects.toThrow(/Invalid object storage key/);
    await expect(storage.get("/etc/passwd")).rejects.toThrow(/Invalid object storage key/);
  });
});
