import { defineConfig } from "drizzle-kit";

// dbCredentials is included only when DATABASE_URL is set so `drizzle-kit
// generate` (schema → SQL, needs no database) works in CI without secrets.
// Apply with `pnpm db:migrate` (src/db/migrate.ts), which loads app/.env.
const url = process.env.DATABASE_URL;

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  ...(url ? { dbCredentials: { url } } : {}),
});
