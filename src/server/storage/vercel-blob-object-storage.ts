import { BlobNotFoundError, del, get, head, put } from "@vercel/blob";
import { assertObjectStorageKey, type ObjectStorage } from "./object-storage";

/**
 * Private, durable object storage for Vercel functions.
 *
 * Object paths deliberately remain Canvas-internal identifiers. Blob URLs are never
 * persisted in domain records or returned to a browser; authenticated domain services
 * read bytes through this adapter instead.
 */
export class VercelBlobObjectStorage implements ObjectStorage {
  private readonly token = process.env.BLOB_READ_WRITE_TOKEN;

  private options() {
    // Let the SDK use Vercel's project credentials/OIDC when a token is not explicitly
    // present, while still supporting `vercel env pull` and non-Vercel test hosts.
    return this.token ? { token: this.token } : {};
  }

  async put(key: string, value: Uint8Array) {
    await put(assertObjectStorageKey(key), Buffer.from(value), {
      access: "private",
      addRandomSuffix: false,
      contentType: "application/octet-stream",
      ...this.options(),
    });
  }

  async get(key: string) {
    const result = await get(assertObjectStorageKey(key), { access: "private", useCache: false, ...this.options() });
    if (!result || result.statusCode !== 200 || !result.stream) throw new Error("Object storage key was not found.");
    return new Uint8Array(await new Response(result.stream).arrayBuffer());
  }

  async exists(key: string) {
    try { await head(assertObjectStorageKey(key), this.options()); return true; }
    catch (error) {
      if (error instanceof BlobNotFoundError) return false;
      throw error;
    }
  }

  async delete(key: string) {
    await del(assertObjectStorageKey(key), this.options());
  }
}
