import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { assertSeparateTestDatabase, testDatabaseUrl } from "./src/server/db/test-database";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const configured = process.env.DATABASE_URL ?? env.DATABASE_URL;
  const testBase = process.env.TEST_DATABASE_URL ?? env.TEST_DATABASE_URL ?? configured;
  const runId = `vitest_${process.pid}_${Date.now().toString(36)}`;
  const resolved = testBase ? testDatabaseUrl(testBase, runId) : undefined;
  if (resolved) {
    assertSeparateTestDatabase(configured, resolved);
    process.env.DATABASE_URL = resolved;
  }
  process.env.CANVAS_CREDENTIAL_KEY ??= env.CANVAS_CREDENTIAL_KEY ?? Buffer.alloc(32, 7).toString("base64url");

  return {
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
    test: {
      environment: "node",
      include: ["src/**/*.integration.test.ts", "src/**/*.e2e.test.ts"],
      globalSetup: ["./vitest.global-setup.ts"],
      // These suites intentionally TRUNCATE shared tables. One fork and one file
      // at a time make that cleanup deterministic without serializing unit tests.
      fileParallelism: false,
      pool: "forks",
      coverage: { reporter: ["text", "html"] },
    },
  };
});
