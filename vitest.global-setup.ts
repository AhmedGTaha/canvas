import postgres from "postgres";
import { runMigrations } from "./src/server/db/migrations";
import { adminDatabaseUrl } from "./src/server/db/test-database";

/**
 * Creates the test database if it is not there yet and brings it up to schema.
 *
 * vitest.config.ts has already pointed DATABASE_URL at it, so everything the
 * suites import connects there rather than to the database the app is using.
 */
export default async function setup() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return;

  const name = new URL(databaseUrl).pathname.replace(/^\//, "");
  const admin = postgres(adminDatabaseUrl(databaseUrl), { max: 1 });
  try {
    const [row] = await admin<{ exists: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = ${name}) AS exists`;
    // CREATE DATABASE cannot be parameterised, and the name comes from our own
    // configuration rather than from a request, but quote it anyway.
    if (!row?.exists) await admin.unsafe(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
  } finally {
    await admin.end();
  }

  await runMigrations(databaseUrl);

  return async () => {
    const cleanup = postgres(adminDatabaseUrl(databaseUrl), { max: 1, onnotice: () => undefined });
    try {
      // Workers have already exited before global teardown. FORCE also cleans up a
      // leaked connection without ever touching the development database.
      await cleanup.unsafe(`DROP DATABASE IF EXISTS "${name.replace(/"/g, '""')}" WITH (FORCE)`);
    } finally {
      await cleanup.end();
    }
  };
}
