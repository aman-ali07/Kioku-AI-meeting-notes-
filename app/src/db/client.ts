import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { requireEnv } from "@/env";
import * as schema from "./schema";

// One postgres-js pool per process, cached across Next dev hot reloads.
// `max: 1` keeps the dev footprint tiny; raise it when the app grows load.
//
// This creates the client at module scope ON PURPOSE: DrizzleAdapter performs
// own-property introspection on the instance, so a lazy proxy wrapper around
// it fails at runtime ("Unsupported database type"). Consequence (documented,
// not hidden): processes that import db evaluate DATABASE_URL at module scope
// — including `next build`, which therefore needs DATABASE_URL present
// (in CI/build you may set a placeholder; the first real connection attempt
// is what actually talks to Postgres).
declare global {
  // eslint-disable-next-line no-var
  var __kiokuSql: postgres.Sql | undefined;
}

const globalForDb = globalThis;

export const sql = globalForDb.__kiokuSql ?? postgres(requireEnv("DATABASE_URL"), { max: 1 });
if (process.env.NODE_ENV !== "production") {
  globalForDb.__kiokuSql = sql;
}

export const db = drizzle(sql, { schema });
export { schema };
