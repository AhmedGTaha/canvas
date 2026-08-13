import { sql } from "@/server/db/client";
import { DomainError } from "@/domain/shared/errors";
import { sha256 } from "@/domain/shared/crypto";
import { observe } from "@/server/observability/events";

export async function consumeRateLimit(scope: string, subject: string, options: { attempts?: number; windowMinutes?: number } = {}) {
  const attempts = options.attempts ?? 8;
  const windowMinutes = options.windowMinutes ?? 15;
  const subjectHash = sha256(subject);
  const [entry] = await sql<{ attempt_count: number }[]>`
    INSERT INTO auth_rate_limits (scope, subject_hash, attempt_count, window_started_at)
    VALUES (${scope}, ${subjectHash}, 1, now())
    ON CONFLICT (scope, subject_hash) DO UPDATE SET
      attempt_count = CASE
        WHEN auth_rate_limits.window_started_at < now() - (${windowMinutes} * interval '1 minute') THEN 1
        ELSE auth_rate_limits.attempt_count + 1
      END,
      window_started_at = CASE
        WHEN auth_rate_limits.window_started_at < now() - (${windowMinutes} * interval '1 minute') THEN now()
        ELSE auth_rate_limits.window_started_at
      END
    RETURNING attempt_count
  `;
  if (entry && entry.attempt_count > attempts) {
    observe.authFailed("rate_limited", { scope });
    throw new DomainError("RATE_LIMITED", "Too many attempts. Try again in a few minutes.");
  }
}

export async function clearRateLimit(scope: string, subject: string) {
  await sql`DELETE FROM auth_rate_limits WHERE scope = ${scope} AND subject_hash = ${sha256(subject)}`;
}
