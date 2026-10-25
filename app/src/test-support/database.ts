import { afterAll, beforeAll } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/** True when TEST_DATABASE_URL is set; DB suites skip otherwise. */
export const hasTestDatabase = Boolean(TEST_DATABASE_URL);

let client: typeof import("@/db/client") | null = null;

/**
 * Connect a suite to TEST_DATABASE_URL. Refuses any database whose name does
 * not end in `_test`: these suites insert and delete rows, so a typo must
 * never touch a real database.
 *
 * `@/db/client` reads DATABASE_URL at import time, so the env is set before
 * the dynamic import. Call from the suite body; use the returned getter inside
 * tests (after `beforeAll` has run).
 */
export function useTestDatabase(): () => typeof import("@/db/client") {
  beforeAll(async () => {
    if (!TEST_DATABASE_URL) return;

    const dbName = new URL(TEST_DATABASE_URL).pathname.replace(/^\//, "");
    if (!dbName.endsWith("_test")) {
      throw new Error(
        `Refusing to run database tests against ${JSON.stringify(dbName)}; use a *_test database`,
      );
    }

    process.env.DATABASE_URL = TEST_DATABASE_URL;
    client = await import("@/db/client");
  });

  afterAll(async () => {
    if (client) {
      await client.sql.end();
      client = null;
    }
  });

  return () => {
    if (!client) throw new Error("Test database was not initialized");
    return client;
  };
}
