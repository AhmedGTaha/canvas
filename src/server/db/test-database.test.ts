import { describe, expect, it } from "vitest";
import { adminDatabaseUrl, assertSeparateTestDatabase, testDatabaseUrl } from "./test-database";

/*
 * The integration suites truncate every table between cases. For most of this
 * project's life they ran against whatever DATABASE_URL pointed at, which meant
 * `npm test` deleted every account and project in the developer's own database.
 * These are the rules that stop that happening again.
 */
describe("choosing a database for tests", () => {
  const dev = "postgresql://canvas:canvas@localhost:5433/canvas";

  it("never lands on the database the app is using", () => {
    expect(testDatabaseUrl(dev)).toBe("postgresql://canvas:canvas@localhost:5433/canvas_test");
    expect(new URL(testDatabaseUrl(dev)).pathname).not.toBe(new URL(dev).pathname);
  });

  it("leaves a database that is already a test database alone", () => {
    const already = "postgresql://canvas:canvas@localhost:5433/canvas_test";
    expect(testDatabaseUrl(already)).toBe(already);
  });

  it("keeps the server, credentials and port it was given", () => {
    const url = new URL(testDatabaseUrl("postgresql://someone:secret@db.internal:6000/production"));
    expect([url.username, url.password, url.host]).toEqual(["someone", "secret", "db.internal:6000"]);
    expect(url.pathname).toBe("/production_test");
  });

  it("reaches the server through a database that always exists, so the test one can be created", () => {
    expect(new URL(adminDatabaseUrl(dev)).pathname).toBe("/postgres");
    expect(new URL(adminDatabaseUrl(dev)).host).toBe("localhost:5433");
  });

  it("refuses a test run aimed at the development database", () => {
    expect(() => assertSeparateTestDatabase(dev, dev)).toThrow(/Refusing to run tests against canvas/);
    // Same name on a different server is a different database, and allowed.
    expect(() => assertSeparateTestDatabase(dev, "postgresql://canvas:canvas@ci.internal:5432/canvas")).not.toThrow();
    expect(() => assertSeparateTestDatabase(dev, testDatabaseUrl(dev))).not.toThrow();
    // Nothing configured means nothing to protect.
    expect(() => assertSeparateTestDatabase(undefined, dev)).not.toThrow();
  });
});
