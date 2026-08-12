import { createHash, randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { and, eq, gt } from "drizzle-orm";
import { db, sql } from "@/server/db/client";
import { authCredentials, sessions, users } from "@/server/db/schema";
import { DomainError } from "@/domain/shared/errors";
import { normalizeEmail } from "./email";
import { signInSchema, signUpSchema } from "./schemas";

const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const RATE_LIMIT_WINDOW_MINUTES = 15;
const RATE_LIMIT_ATTEMPTS = 8;

export type AuthenticatedUser = Pick<typeof users.$inferSelect, "id" | "email" | "displayName" | "avatarUrl">;

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function consumeRateLimit(scope: string, subject: string) {
  const subjectHash = digest(subject);
  const [entry] = await sql<{ attempt_count: number }[]>`
    INSERT INTO auth_rate_limits (scope, subject_hash, attempt_count, window_started_at)
    VALUES (${scope}, ${subjectHash}, 1, now())
    ON CONFLICT (scope, subject_hash) DO UPDATE SET
      attempt_count = CASE
        WHEN auth_rate_limits.window_started_at < now() - (${RATE_LIMIT_WINDOW_MINUTES} * interval '1 minute') THEN 1
        ELSE auth_rate_limits.attempt_count + 1
      END,
      window_started_at = CASE
        WHEN auth_rate_limits.window_started_at < now() - (${RATE_LIMIT_WINDOW_MINUTES} * interval '1 minute') THEN now()
        ELSE auth_rate_limits.window_started_at
      END
    RETURNING attempt_count
  `;
  if (entry && entry.attempt_count > RATE_LIMIT_ATTEMPTS) {
    throw new DomainError("RATE_LIMITED", "Too many attempts. Try again in a few minutes.");
  }
}

async function clearRateLimit(scope: string, subject: string) {
  await sql`DELETE FROM auth_rate_limits WHERE scope = ${scope} AND subject_hash = ${digest(subject)}`;
}

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
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      throw new DomainError("CONFLICT", "An account with that email already exists.");
    }
    throw error;
  }
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
    throw new DomainError("ACCESS_DENIED", "Email or password is incorrect.");
  }

  if (!(await verify(record.passwordHash, parsed.password))) {
    throw new DomainError("ACCESS_DENIED", "Email or password is incorrect.");
  }
  await clearRateLimit("sign-in", normalizedEmail);
  return record.user;
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
  await db.insert(sessions).values({ userId, tokenHash: digest(token), expiresAt });
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
    .where(and(eq(sessions.tokenHash, digest(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return record ?? null;
}

export async function revokeSession(token: string) {
  await db.delete(sessions).where(eq(sessions.tokenHash, digest(token)));
}
