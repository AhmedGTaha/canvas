import { LocalObjectStorage } from "./local-object-storage";
import { ObservedObjectStorage } from "./observed-object-storage";
import { VercelBlobObjectStorage } from "./vercel-blob-object-storage";
import type { ObjectStorage } from "./object-storage";

let storage: ObjectStorage | undefined;

export function getObjectStorage(): ObjectStorage {
  // A production Vercel function must never silently fall back to its ephemeral disk.
  const driver = process.env.STORAGE_DRIVER || (process.env.VERCEL ? "vercel-blob" : "local");
  if (driver === "local") return storage ??= new ObservedObjectStorage(new LocalObjectStorage());
  if (driver === "vercel-blob") return storage ??= new ObservedObjectStorage(new VercelBlobObjectStorage());
  throw new Error(`Unsupported object storage driver: ${driver}`);
}

export type { ObjectStorage } from "./object-storage";
