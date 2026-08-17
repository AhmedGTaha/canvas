export interface ObjectStorage {
  put(key: string, value: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}

/** Shared key guard: providers receive only private, application-controlled paths. */
export function assertObjectStorageKey(key: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/.test(key)) throw new Error("Invalid object storage key.");
  return key;
}
