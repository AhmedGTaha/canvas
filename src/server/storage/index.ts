import { LocalObjectStorage } from "./local-object-storage";
import type { ObjectStorage } from "./object-storage";

let storage: ObjectStorage | undefined;

export function getObjectStorage(): ObjectStorage {
  const driver = process.env.STORAGE_DRIVER || "local";
  if (driver !== "local") throw new Error(`Unsupported object storage driver: ${driver}`);
  return storage ??= new LocalObjectStorage();
}

export type { ObjectStorage } from "./object-storage";
