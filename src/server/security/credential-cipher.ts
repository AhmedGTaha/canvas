import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import { DomainError } from "@/domain/shared/errors";

/**
 * Authenticated encryption for account provider credentials.
 *
 * The only secret that stays in the environment is the Canvas master key
 * (`CANVAS_CREDENTIAL_KEY`). Provider credentials live in the database as AES-256-GCM
 * ciphertext, bound with additional authenticated data to the connection *and its owner*,
 * so a row copied to another connection or another account cannot be decrypted.
 *
 * Two wire formats exist, both `<format>.<iv>.<tag>.<ciphertext>` in base64url:
 *   v2  bound to the owning account — everything written from now on.
 *   v1  bound to the workspace that owned the connection before credentials became
 *       account-scoped. Still readable so nobody has to re-enter a working API key;
 *       never written. Any save or rotation upgrades the row to v2.
 */
export const CREDENTIAL_KEY_VERSION = 2;
const FORMAT = "v2";
const LEGACY_FORMAT = "v1";
const IV_BYTES = 12;

function encode(value: Buffer) { return value.toString("base64url"); }
function decode(value: string) { return Buffer.from(value, "base64url"); }

/**
 * The 32-byte master key. Accepts base64, base64url, or hex so an operator can paste
 * whatever their generator produced, and fails loudly rather than silently encrypting
 * with a weak key.
 */
export function credentialMasterKey(environment: NodeJS.ProcessEnv = process.env) {
  const raw = environment.CANVAS_CREDENTIAL_KEY?.trim();
  if (!raw) throw new DomainError("VALIDATION", "Canvas is not configured to store AI credentials. Set CANVAS_CREDENTIAL_KEY.");
  const candidate = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64url");
  if (candidate.length !== 32) throw new DomainError("VALIDATION", "Canvas is not configured to store AI credentials. CANVAS_CREDENTIAL_KEY must be 32 bytes.");
  return candidate;
}

/** True when credentials can be stored. Used to explain the state, never to bypass it. */
export function credentialEncryptionAvailable(environment: NodeJS.ProcessEnv = process.env) {
  try { credentialMasterKey(environment); return true; } catch { return false; }
}

/** The credential's owner, and the row it belongs to. Both bind the ciphertext. */
export type CredentialScope = {
  connectionId: string;
  userId: string;
  /** Only set on rows created before credentials became account-scoped. */
  legacyWorkspaceId?: string | null;
};

function aad(format: string, scope: CredentialScope) {
  return format === LEGACY_FORMAT
    ? Buffer.from(`canvas:ai-connection:${scope.legacyWorkspaceId}:${scope.connectionId}`, "utf8")
    : Buffer.from(`canvas:ai-connection:user:${scope.userId}:${scope.connectionId}`, "utf8");
}

const unreadable = () => new DomainError("VALIDATION", "This AI connection's stored credential is unreadable. Re-enter the API key.");

export function encryptCredential(plaintext: string, scope: CredentialScope) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", credentialMasterKey(), iv, { authTagLength: 16 });
  cipher.setAAD(aad(FORMAT, scope));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `${FORMAT}.${encode(iv)}.${encode(cipher.getAuthTag())}.${encode(ciphertext)}`;
}

export function decryptCredential(value: string, scope: CredentialScope) {
  const [format, iv, tag, ciphertext] = value.split(".");
  if ((format !== FORMAT && format !== LEGACY_FORMAT) || !iv || !tag || !ciphertext) throw unreadable();
  // A legacy row whose workspace binding was not supplied cannot be decrypted, and must
  // not silently fall through to the account binding it was never sealed with.
  if (format === LEGACY_FORMAT && !scope.legacyWorkspaceId) throw unreadable();
  try {
    const decipher = createDecipheriv("aes-256-gcm", credentialMasterKey(), decode(iv), { authTagLength: 16 });
    decipher.setAAD(aad(format, scope));
    decipher.setAuthTag(decode(tag));
    return Buffer.concat([decipher.update(decode(ciphertext)), decipher.final()]).toString("utf8");
  } catch {
    // A tampered row, a rotated key, or a row lifted from another connection or another
    // account all land here. None of them may fall back to anything usable.
    throw unreadable();
  }
}

/**
 * The only representation of a credential a browser ever receives: enough to recognise
 * which key is stored, never enough to use it.
 */
export function credentialHint(plaintext: string) {
  const trimmed = plaintext.trim();
  return trimmed.length <= 4 ? "••••" : `••••${trimmed.slice(-4)}`;
}

/** Constant-time comparison for credential equality checks in tests and rotation. */
export function credentialsMatch(left: string, right: string) {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
