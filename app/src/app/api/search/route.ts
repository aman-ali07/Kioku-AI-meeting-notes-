import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { getPrimaryWorkspace } from "@/lib/workspace";
import { SEARCH_MAX_CHARS, searchMeetings } from "@/lib/search";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Tenant-scoped meeting search: /api/search?q=... */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!session || !userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const primary = await getPrimaryWorkspace(userId);
  if (!primary) {
    return NextResponse.json({ error: "No workspace" }, { status: 403 });
  }

  const rawQuery = request.nextUrl.searchParams.get("q") ?? "";
  if (rawQuery.trim().length > SEARCH_MAX_CHARS) {
    return NextResponse.json(
      { error: `Query too long (max ${SEARCH_MAX_CHARS} characters)` },
      { status: 400 },
    );
  }

  const query = rawQuery.trim();
  const results = await searchMeetings(primary.workspace.id, query);
  return NextResponse.json({ query, count: results.length, results });
}
