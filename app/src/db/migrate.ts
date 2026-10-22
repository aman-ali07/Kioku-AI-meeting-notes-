/**
 * Migration runner: `pnpm db:migrate` → tsx src/db/migrate.ts
 *
 * Deliberately dependency-light: a ~10-line .env reader instead of dotenv,
 * because tsx does not auto-load Next-style .env files. Existing process env
 * always wins over .env (12-factor precedence).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "../..");

// No .env file is a normal case (deployment configures env directly) — this
// catch is a documented absence, not a swallowed failure.
try {
  const env = readFileSync(resolve(appRoot, ".env"), "utf8");
  for (const line of env.split("\n")) {
    const parsed = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (parsed && !process.env[parsed[1]]) {
      process.env[parsed[1]] = parsed[2].replace(/^["']|["']$/g, "");
    }
  }
} catch {
  console.log("No app/.env file found — relying on the process environment.");
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    "DATABASE_URL is not set. Add it to app/.env (see app/.env.example).",
  );
  process.exit(1);
}

const sql = postgres(url, { max: 1 });

try {
  const start = Date.now();
  await migrate(drizzle(sql), { migrationsFolder: resolve(appRoot, "drizzle") });
  console.log(`✅ migrations applied in ${Date.now() - start}ms`);
} catch (error) {
  console.error("❌ migration failed:", error);
  process.exit(1);
} finally {
  await sql.end();
}
