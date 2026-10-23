import { sql } from "drizzle-orm";
import { promises as fs } from "node:fs";
import { db } from "@/db/client";

// force-dynamic stops Next from statically evaluating this GET at build time
// (which would require DATABASE_URL during `next build`).
export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, string> = {};
  let ok = true;

  const storageDir = process.env.STORAGE_DIR;
  if (!storageDir) {
    ok = false;
    checks.storage = "error";
    console.error("[healthz] STORAGE_DIR is not set");
  } else {
    try {
      // The app writes audio here on upload (the worker only reads), so this
      // process can state storage health honestly: ensure + check usable.
      await fs.mkdir(storageDir, { recursive: true });
      await fs.access(storageDir, fs.constants.R_OK | fs.constants.W_OK);
      checks.storage = "ok";
    } catch {
      ok = false;
      checks.storage = "error";
      // Surface the cause in server logs; the response stays non-sensitive.
      console.error("[healthz] STORAGE_DIR not usable:", storageDir);
    }
  }

  try {
    await db.execute(sql`select 1`);
    checks.db = "ok";
  } catch (error) {
    ok = false;
    checks.db = "error";
    // Surface the cause in server logs; the response stays non-sensitive.
    console.error("[healthz] db check failed:", error);
  }

  return Response.json(
    {
      service: "kioku-app",
      status: ok ? "ok" : "degraded",
      checks,
    },
    { status: ok ? 200 : 503 },
  );
}
