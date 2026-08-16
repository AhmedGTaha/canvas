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
  // Workspace AI credentials are always stored encrypted, including in tests. A fixed
  // test key keeps suites hermetic without anyone having to configure one.
  process.env.CANVAS_CREDENTIAL_KEY ??= env.CANVAS_CREDENTIAL_KEY ?? Buffer.alloc(32, 7).toString("base64url");
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
