import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { DomainError } from "@/domain/shared/errors";

const payloadSchema = z.object({ version: z.literal(1), sessionId: z.string().regex(/^[A-Za-z0-9_-]{22}$/), projectId: z.uuid(), userId: z.uuid(), expiresAt: z.number().int().positive() }).strict();
export type PreviewTokenPayload = z.infer<typeof payloadSchema>;

function configuredSecret() {
  const secret = process.env.PREVIEW_TOKEN_SECRET;
  if (!secret || secret.length < 32) throw new Error("PREVIEW_TOKEN_SECRET must contain at least 32 characters.");
  return secret;
}

export class PreviewTokenService {
  constructor(private readonly secret = configuredSecret(), private readonly now = () => Date.now()) {}

  issue(projectId: string, userId: string) {
    const ttlSeconds = Number(process.env.PREVIEW_TOKEN_TTL_SECONDS || 300);
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > 900) throw new Error("PREVIEW_TOKEN_TTL_SECONDS must be between 30 and 900.");
    const payload: PreviewTokenPayload = { version: 1, sessionId: randomBytes(16).toString("base64url"), projectId, userId, expiresAt: this.now() + ttlSeconds * 1000 };
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return { token: `${encoded}.${this.sign(encoded)}`, payload };
  }

  verify(token: string) {
    const [encoded, signature, extra] = token.split(".");
    if (!encoded || !signature || extra) throw new DomainError("ACCESS_DENIED", "This preview session is invalid.");
    const expected = Buffer.from(this.sign(encoded)); const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new DomainError("ACCESS_DENIED", "This preview session is invalid.");
    try {
      const payload = payloadSchema.parse(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")));
      if (payload.expiresAt <= this.now()) throw new DomainError("ACCESS_DENIED", "This preview session has expired.");
      return payload;
    } catch (error) { if (error instanceof DomainError) throw error; throw new DomainError("ACCESS_DENIED", "This preview session is invalid."); }
  }

  private sign(value: string) { return createHmac("sha256", this.secret).update(value).digest("base64url"); }
}
