import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

async function migrate() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required to run migrations.");

  const client = postgres(databaseUrl, { max: 1 });
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
      console.log(`Applied ${file}`);
    }
  } finally {
    await client.end();
  }
}

migrate().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Migration failed.");
  process.exitCode = 1;
});
