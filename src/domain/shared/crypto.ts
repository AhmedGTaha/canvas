import { createHash, randomBytes } from "node:crypto";

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function createSecureToken() {
  return randomBytes(32).toString("base64url");
}
