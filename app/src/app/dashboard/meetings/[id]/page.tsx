import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { asc, eq } from "drizzle-orm";
import { authOptions } from "@/auth";
import { db } from "@/db/client";
import { meetings, transcriptSegments } from "@/db/schema";
import { getPrimaryWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-fA-F-]{36}$/;

function formatTime(startMs: number): string {
  const total = Math.floor(startMs / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export default async function MeetingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!session || !userId) {
    redirect("/login?callbackUrl=/dashboard");
  }
  const primary = await getPrimaryWorkspace(userId);
  if (!primary) notFound();

  const [meeting] = await db
    .select()
    .from(meetings)
    .where(eq(meetings.id, id))
    .limit(1);
  // The id must belong to the caller's workspace: anything else (even an
  // existing row in another tenant) is a 404 — never leak existence.
  if (!meeting || meeting.workspaceId !== primary.workspace.id) notFound();

  const segments = await db
    .select({
      idx: transcriptSegments.idx,
      startMs: transcriptSegments.startMs,
      text: transcriptSegments.text,
      confidence: transcriptSegments.confidence,
    })
    .from(transcriptSegments)
    .where(eq(transcriptSegments.meetingId, id))
    .orderBy(asc(transcriptSegments.idx));

  // Retention is per-workspace policy; show the user exactly when the
  // auto-purge lands (the free-tier differentiator, visible not hidden).
  const purgeDate = new Date(
    meeting.createdAt.getTime() + primary.workspace.retentionDays * 86_400_000,
  )
    .toISOString()
    .slice(0, 10);

  return (
    <main className="min-h-screen bg-neutral-900 p-8 text-neutral-100">
      <div className="mx-auto max-w-3xl">
        <Link href="/dashboard" className="text-sm text-neutral-400 hover:text-neutral-200">
          ← Back to meetings
        </Link>
        <h1 className="mt-3 text-2xl font-semibold">{meeting.title}</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Status: <span className="text-neutral-200">{meeting.status}</span> ·{" "}
          {meeting.durationMs === null
            ? "duration pending"
            : `${Math.round(meeting.durationMs / 1000)}s`}
        </p>
        <p className="mt-1 text-sm text-neutral-400">
          Auto-purges on <span className="text-neutral-200">{purgeDate}</span> (
          {primary.workspace.retentionDays}-day workspace retention).
        </p>
        <a
          href={`/api/meetings/${meeting.id}/export`}
          className="mt-3 inline-block rounded bg-neutral-100 px-4 py-1.5 text-sm font-medium text-neutral-900"
        >
          Download full export (.zip)
        </a>

        {segments.length === 0 ? (
          <p className="mt-8 text-sm text-neutral-400">
            No transcript segments yet — refresh once the meeting finishes
            processing.
          </p>
        ) : (
          <ol className="mt-6 space-y-3 text-sm">
            {segments.map((s) => (
              <li key={s.idx} className="flex gap-3">
                <span className="w-12 shrink-0 text-neutral-500">
                  {formatTime(s.startMs)}
                </span>
                <span className="flex-1">{s.text}</span>
                <span
                  className={
                    s.confidence < 50
                      ? "w-10 shrink-0 text-right text-red-400"
                      : "w-10 shrink-0 text-right text-neutral-500"
                  }
                >
                  {s.confidence}%
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </main>
  );
}
