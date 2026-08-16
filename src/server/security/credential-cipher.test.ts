import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createCipheriv, randomBytes } from "node:crypto";
import { credentialEncryptionAvailable, credentialHint, credentialMasterKey, decryptCredential, encryptCredential } from "./credential-cipher";

/** Reproduces exactly what the pre-account cipher wrote, so the read path is real. */
function legacyCiphertext(plaintext: string, binding: { connectionId: string; workspaceId: string }) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", credentialMasterKey(), iv, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(`canvas:ai-connection:${binding.workspaceId}:${binding.connectionId}`, "utf8"));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), body].map((part) => (typeof part === "string" ? part : part.toString("base64url"))).join(".");
}

const KEY = Buffer.alloc(32, 3).toString("base64url");
const scope = { connectionId: randomUUID(), userId: randomUUID() };
const environment = { ...process.env };
afterEach(() => { process.env = { ...environment }; });

describe("credential encryption", () => {
  it("round-trips a credential and never stores it in the clear", () => {
    process.env.CANVAS_CREDENTIAL_KEY = KEY;
    const ciphertext = encryptCredential("sk-live-abcdef123456", scope);
    expect(ciphertext).not.toContain("sk-live-abcdef123456");
    expect(ciphertext.startsWith("v2.")).toBe(true);
    expect(decryptCredential(ciphertext, scope)).toBe("sk-live-abcdef123456");
  });

  it("produces a different ciphertext each time so equal keys are not linkable", () => {
    process.env.CANVAS_CREDENTIAL_KEY = KEY;
    expect(encryptCredential("same-key-value", scope)).not.toBe(encryptCredential("same-key-value", scope));
  });

  it("refuses ciphertext lifted into another connection or another account", () => {
    process.env.CANVAS_CREDENTIAL_KEY = KEY;
    const ciphertext = encryptCredential("sk-live-abcdef123456", scope);
    expect(() => decryptCredential(ciphertext, { ...scope, connectionId: randomUUID() })).toThrow(/unreadable/i);
    expect(() => decryptCredential(ciphertext, { ...scope, userId: randomUUID() })).toThrow(/unreadable/i);
  });

  /**
   * Credentials written before AI settings became account-scoped were sealed against the
   * workspace that owned them. They stay readable so nobody has to re-enter a working key,
   * and only when the migration's recorded workspace is supplied.
   */
  it("still reads a pre-migration credential, and only with its own workspace binding", () => {
    process.env.CANVAS_CREDENTIAL_KEY = KEY;
    const legacyWorkspaceId = randomUUID();
    const legacy = legacyCiphertext("sk-live-legacy-000000", { connectionId: scope.connectionId, workspaceId: legacyWorkspaceId });
    expect(decryptCredential(legacy, { ...scope, legacyWorkspaceId })).toBe("sk-live-legacy-000000");
    // Without the binding it is unreadable rather than silently falling back to the
    // account binding it was never sealed with.
    expect(() => decryptCredential(legacy, scope)).toThrow(/unreadable/i);
    expect(() => decryptCredential(legacy, { ...scope, legacyWorkspaceId: randomUUID() })).toThrow(/unreadable/i);
  });

  it("refuses tampered ciphertext rather than returning partial plaintext", () => {
    process.env.CANVAS_CREDENTIAL_KEY = KEY;
    const [format, iv, tag, body] = encryptCredential("sk-live-abcdef123456", scope).split(".");
    const flipped = Buffer.from(body!, "base64url");
    flipped[0] = flipped[0]! ^ 0xff;
    expect(() => decryptCredential(`${format}.${iv}.${tag}.${flipped.toString("base64url")}`, scope)).toThrow(/unreadable/i);
  });

  it("refuses ciphertext encrypted under a different master key", () => {
    process.env.CANVAS_CREDENTIAL_KEY = KEY;
    const ciphertext = encryptCredential("sk-live-abcdef123456", scope);
    process.env.CANVAS_CREDENTIAL_KEY = Buffer.alloc(32, 9).toString("base64url");
    expect(() => decryptCredential(ciphertext, scope)).toThrow(/unreadable/i);
  });

  it("requires a real 32-byte master key and reports availability honestly", () => {
    delete process.env.CANVAS_CREDENTIAL_KEY;
    expect(credentialEncryptionAvailable()).toBe(false);
    expect(() => credentialMasterKey()).toThrow(/CANVAS_CREDENTIAL_KEY/);
    process.env.CANVAS_CREDENTIAL_KEY = "too-short";
    expect(credentialEncryptionAvailable()).toBe(false);
    process.env.CANVAS_CREDENTIAL_KEY = Buffer.alloc(32, 1).toString("hex");
    expect(credentialEncryptionAvailable()).toBe(true);
  });

  it("masks a credential down to a hint that cannot be used", () => {
    expect(credentialHint("sk-live-abcdef123456")).toBe("••••3456");
    expect(credentialHint("abc")).toBe("••••");
    expect(credentialHint("sk-live-abcdef123456")).not.toContain("sk-live");
  });
});
