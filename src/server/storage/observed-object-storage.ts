import { observe } from "@/server/observability/events";
import type { ObjectStorage } from "./object-storage";

/**
 * Wraps any storage driver so transient failures are always visible operationally.
 * Storage keys are never logged; only the operation and a stable failure reason are.
 */
export class ObservedObjectStorage implements ObjectStorage {
  constructor(private readonly inner: ObjectStorage) {}

  private async guard<T>(operation: "put" | "get" | "delete" | "exists", action: () => Promise<T>) {
    try { return await action(); }
    catch (error) { observe.storageFailure(operation, error); throw error; }
  }

  put(key: string, value: Uint8Array) { return this.guard("put", () => this.inner.put(key, value)); }
  get(key: string) { return this.guard("get", () => this.inner.get(key)); }
  exists(key: string) { return this.guard("exists", () => this.inner.exists(key)); }
  delete(key: string) { return this.guard("delete", () => this.inner.delete(key)); }
}
