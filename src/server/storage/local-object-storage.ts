import { access, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertObjectStorageKey, type ObjectStorage } from "./object-storage";

export class LocalObjectStorage implements ObjectStorage {
  private readonly root: string;

  constructor(root = process.env.LOCAL_STORAGE_PATH || ".canvas-storage") {
    this.root = path.resolve(/* turbopackIgnore: true */ process.cwd(), root);
  }

  private resolve(key: string) {
    const resolved = path.resolve(this.root, assertObjectStorageKey(key));
    if (resolved === this.root || !resolved.startsWith(`${this.root}${path.sep}`)) throw new Error("Object storage key escapes its root.");
    return resolved;
  }

  async put(key: string, value: Uint8Array) {
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, value, { flag: "wx" });
  }

  async get(key: string) {
    return readFile(this.resolve(key));
  }

  async exists(key: string) {
    try { await access(this.resolve(key)); return true; } catch (error: unknown) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
      throw error;
    }
  }

  async delete(key: string) {
    try { await unlink(this.resolve(key)); } catch (error: unknown) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
}
