import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { assertSeparateTestDatabase, testDatabaseUrl } from "./src/server/db/test-database";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const configured = process.env.DATABASE_URL ?? env.DATABASE_URL;
  // The integration suites truncate every table between cases. Running them
  // against the database the app is using deletes every account and project in
  // it, so the tests always get their own — TEST_DATABASE_URL when it is set,
  // otherwise the configured database with _test appended, created on demand by
  // the global setup below.
  const resolved = process.env.TEST_DATABASE_URL ?? env.TEST_DATABASE_URL ?? (configured ? testDatabaseUrl(configured) : undefined);
  if (resolved) {
    assertSeparateTestDatabase(configured, resolved);
    process.env.DATABASE_URL = resolved;
  }
  return {
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
    test: {
      environment: "node",
      include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
      globalSetup: ["./vitest.global-setup.ts"],
      fileParallelism: false,
      coverage: { reporter: ["text", "html"] },
    },
  };
});
