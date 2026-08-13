import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

/**
 * Applies every migration a database has not seen yet, in filename order.
 *
 * Separate from the CLI in migrate.ts so the test harness can bring its own
 * database up to schema without shelling out.
 */
export async function runMigrations(databaseUrl: string, log: (message: string) => void = () => undefined) {
  // "already exists, skipping" notices are the normal case on a re-run and only
  // make real output harder to spot.
  const client = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  const directory = path.join(process.cwd(), "migrations");
  const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();

  try {
    await client`CREATE TABLE IF NOT EXISTS schema_migrations (
      version varchar(255) PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`;

    for (const file of files) {
      const applied = await client`SELECT 1 FROM schema_migrations WHERE version = ${file}`;
      if (applied.length > 0) continue;
      const migration = await readFile(path.join(directory, file), "utf8");
      await client.begin(async (transaction) => {
        await transaction.unsafe(migration);
        await transaction`INSERT INTO schema_migrations (version) VALUES (${file}) ON CONFLICT DO NOTHING`;
      });
      log(`Applied ${file}`);
    }
  } finally {
    await client.end();
  }
}
