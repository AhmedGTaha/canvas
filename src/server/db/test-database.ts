/**
 * Where the test suites are allowed to run.
 *
 * The integration suites truncate every table between cases, so pointing them at
 * the database the app is using destroys every account and project in it. They
 * get a database of their own instead, derived from the configured one so there
 * is nothing extra to set up, and nothing to forget to set up.
 */
export function testDatabaseUrl(databaseUrl: string, runId?: string) {
  const url = new URL(databaseUrl);
  const name = url.pathname.replace(/^\//, "") || "postgres";
  const testName = `${name}${name.endsWith("_test") ? "" : "_test"}`;
  // Each Vitest invocation owns a database. Independent test commands otherwise
  // race when their integration suites truncate the same shared tables.
  url.pathname = `/${runId ? `${testName}_${runId}` : testName}`;
  return url.toString();
}

/** The same server, addressed through a database that always exists, so the
 *  test database can be created before anything connects to it. */
export function adminDatabaseUrl(databaseUrl: string) {
  const url = new URL(databaseUrl);
  url.pathname = "/postgres";
  return url.toString();
}

/** Refuses a test run that would land on the development database. */
export function assertSeparateTestDatabase(configured: string | undefined, resolved: string) {
  if (!configured) return;
  if (new URL(resolved).pathname === new URL(configured).pathname && new URL(resolved).host === new URL(configured).host) {
    throw new Error(
      `Refusing to run tests against ${new URL(configured).pathname.slice(1)}: the integration suites truncate every table, ` +
      "which would delete every account and project in it. Set TEST_DATABASE_URL to a database used only for tests.",
    );
  }
}
