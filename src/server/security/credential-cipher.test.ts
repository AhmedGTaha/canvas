import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { credentialEncryptionAvailable, credentialHint, credentialMasterKey, decryptCredential, encryptCredential } from "./credential-cipher";

const KEY = Buffer.alloc(32, 3).toString("base64url");
const scope = { connectionId: randomUUID(), workspaceId: randomUUID() };
const environment = { ...process.env };
afterEach(() => { process.env = { ...environment }; });

describe("credential encryption", () => {
  it("round-trips a credential and never stores it in the clear", () => {
    process.env.CANVAS_CREDENTIAL_KEY = KEY;
    const ciphertext = encryptCredential("sk-live-abcdef123456", scope);
    expect(ciphertext).not.toContain("sk-live-abcdef123456");
    expect(ciphertext.startsWith("v1.")).toBe(true);
    expect(decryptCredential(ciphertext, scope)).toBe("sk-live-abcdef123456");
  });

  it("produces a different ciphertext each time so equal keys are not linkable", () => {
    process.env.CANVAS_CREDENTIAL_KEY = KEY;
    expect(encryptCredential("same-key-value", scope)).not.toBe(encryptCredential("same-key-value", scope));
  });

  it("refuses ciphertext lifted into another connection or workspace", () => {
    process.env.CANVAS_CREDENTIAL_KEY = KEY;
    const ciphertext = encryptCredential("sk-live-abcdef123456", scope);
    expect(() => decryptCredential(ciphertext, { ...scope, connectionId: randomUUID() })).toThrow(/unreadable/i);
    expect(() => decryptCredential(ciphertext, { ...scope, workspaceId: randomUUID() })).toThrow(/unreadable/i);
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
