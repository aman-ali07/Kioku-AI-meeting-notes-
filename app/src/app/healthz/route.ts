import { sql } from "drizzle-orm";
import { db } from "@/db/client";

// force-dynamic stops Next from statically evaluating this GET at build time
// (which would require DATABASE_URL during `next build`).
export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, string> = {
    // Storage (S3/MinIO) and queue/worker checks arrive with the Days 4–6
    // milestone — staged honestly rather than faked green.
    storage: "not-provisioned (Days 4–6)",
  };
  let ok = true;

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
