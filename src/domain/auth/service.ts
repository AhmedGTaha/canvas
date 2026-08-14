import { hash, verify } from "@node-rs/argon2";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/server/db/client";
import { authCredentials, sessions, users } from "@/server/db/schema";
import { DomainError } from "@/domain/shared/errors";
import { normalizeEmail } from "./email";
import { signInSchema, signUpSchema } from "./schemas";
import { createSecureToken, sha256 } from "@/domain/shared/crypto";
import { clearRateLimit, consumeRateLimit } from "@/server/rate-limit/service";
import { observe } from "@/server/observability/events";

const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export type AuthenticatedUser = Pick<typeof users.$inferSelect, "id" | "email" | "displayName" | "avatarUrl">;

export async function register(input: unknown) {
  const parsed = signUpSchema.parse(input);
  const normalizedEmail = normalizeEmail(parsed.email);
  await consumeRateLimit("sign-up", normalizedEmail);
  const passwordHash = await hash(parsed.password, { algorithm: 2, memoryCost: 19456, timeCost: 3, parallelism: 1 });

  try {
    const user = await db.transaction(async (transaction) => {
      const [created] = await transaction.insert(users).values({
        email: parsed.email.trim(),
        normalizedEmail,
        displayName: parsed.displayName,
      }).returning();
      if (!created) throw new Error("User insert did not return a record.");
      await transaction.insert(authCredentials).values({ userId: created.id, passwordHash });
      return created;
    });
    await clearRateLimit("sign-up", normalizedEmail);
    return user;
  } catch (error: unknown) {
    if (isUniqueViolation(error)) {
      throw new DomainError("CONFLICT", "An account already uses that email address. Sign in instead, or use another address.");
    }
    throw error;
  }
}

/**
 * Postgres reports a duplicate email as SQLSTATE 23505, but Drizzle wraps the
 * driver error in a `DrizzleQueryError` and the code moves to `cause`. Checking
 * only the outer error made the conflict branch unreachable, so a second
 * sign-up with the same address fell through to the generic failure message
 * instead of saying the address was taken.
 */
function isUniqueViolation(error: unknown): boolean {
  for (let current = error, depth = 0; current && depth < 4; depth += 1) {
    if (typeof current === "object" && "code" in current && (current as { code?: unknown }).code === "23505") return true;
    current = typeof current === "object" && current !== null && "cause" in current ? (current as { cause?: unknown }).cause : undefined;
  }
  return false;
}

export async function authenticate(input: unknown) {
  const parsed = signInSchema.parse(input);
  const normalizedEmail = normalizeEmail(parsed.email);
  await consumeRateLimit("sign-in", normalizedEmail);
  const [record] = await db.select({ user: users, passwordHash: authCredentials.passwordHash })
    .from(users)
    .innerJoin(authCredentials, eq(authCredentials.userId, users.id))
    .where(eq(users.normalizedEmail, normalizedEmail))
    .limit(1);

  if (!record) {
    await hash(parsed.password, { algorithm: 2, memoryCost: 19456, timeCost: 3, parallelism: 1 });
    observe.authFailed("invalid_credentials");
    throw new DomainError("ACCESS_DENIED", "Email or password is incorrect.");
  }

  if (!(await verify(record.passwordHash, parsed.password))) {
    observe.authFailed("invalid_credentials");
    throw new DomainError("ACCESS_DENIED", "Email or password is incorrect.");
  }
  await clearRateLimit("sign-in", normalizedEmail);
  return record.user;
}

export async function createSession(userId: string) {
  const token = createSecureToken();
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
  await db.insert(sessions).values({ userId, tokenHash: sha256(token), expiresAt });
  return { token, expiresAt };
}

export async function readSession(token: string): Promise<AuthenticatedUser | null> {
  const [record] = await db.select({
    id: users.id,
    email: users.email,
    displayName: users.displayName,
    avatarUrl: users.avatarUrl,
  }).from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return record ?? null;
}

export async function revokeSession(token: string) {
  await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
}
