import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { desc, eq } from "drizzle-orm";
import { authOptions } from "@/auth";
import { db } from "@/db/client";
import { meetings } from "@/db/schema";
import { getPrimaryWorkspace } from "@/lib/workspace";
import {
  SEARCH_MAX_CHARS,
  SEARCH_MIN_CHARS,
  searchMeetings,
  type SnippetPart,
} from "@/lib/search";
import { SignOutButton } from "@/components/sign-out-button";
import { UploadForm } from "@/components/upload-form";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  uploaded: "Uploaded",
  queued: "Queued",
  processing: "Transcribing…",
  completed: "Completed",
  low_confidence: "Low confidence",
  failed: "Failed",
};

function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return "—";
  const total = Math.round(durationMs / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function Snippet({ parts }: { parts: SnippetPart[] }) {
  return (
    <span>
      {parts.map((part, index) =>
        part.match ? (
          <mark
            key={index}
            className="rounded bg-neutral-700 px-0.5 text-neutral-100"
          >
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </span>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!session || !userId) {
    // A session without a user id is malformed (stale token, broken config) —
    // treat it as signed out rather than querying a tenant on an empty id.
    redirect("/login?callbackUrl=/dashboard");
  }
  const primary = await getPrimaryWorkspace(userId);

  const qParam = (await searchParams).q;
  const query = (Array.isArray(qParam) ? qParam[0] ?? "" : qParam ?? "")
    .trim()
    .slice(0, SEARCH_MAX_CHARS);
  const results =
    primary && query.length >= SEARCH_MIN_CHARS
      ? await searchMeetings(primary.workspace.id, query)
      : [];

  const list = primary
    ? await db
        .select({
          id: meetings.id,
          title: meetings.title,
          status: meetings.status,
          durationMs: meetings.durationMs,
          createdAt: meetings.createdAt,
        })
        .from(meetings)
        .where(eq(meetings.workspaceId, primary.workspace.id))
        .orderBy(desc(meetings.createdAt))
        .limit(50)
    : [];

  return (
    <main className="min-h-screen bg-neutral-900 p-8 text-neutral-100">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Kioku</h1>
          <SignOutButton />
        </div>
        <p className="mt-2 text-sm text-neutral-400">
          Signed in as{" "}
          <span className="text-neutral-100">{session.user?.email ?? userId}</span>
        </p>

        {primary ? (
          <section className="mt-8 rounded-lg border border-neutral-700 p-6">
            <p className="text-lg font-medium">{primary.workspace.name}</p>
            <p className="mt-1 text-sm text-neutral-400">
              Your role: <span className="text-neutral-200">{primary.role}</span>
            </p>
            <p className="mt-1 text-sm text-neutral-400">
              Plan: <span className="text-neutral-200">{primary.workspace.billingPlan}</span>
            </p>
            <p className="mt-1 text-sm text-neutral-400">
              Retention: {primary.workspace.retentionDays} days
            </p>
          </section>
        ) : (
          <section className="mt-8 rounded-lg border border-neutral-700 p-6">
            <p className="text-sm text-neutral-300">
              No workspace found for your account. Sign out and back in to
              re-provision it — if that persists, it&apos;s a bug.
            </p>
          </section>
        )}

        {primary ? (
          <section className="mt-8">
            <h2 className="text-lg font-medium">Search</h2>
            <form action="/dashboard" method="get" className="mt-3 flex gap-2">
              <input
                type="search"
                name="q"
                defaultValue={query}
                maxLength={SEARCH_MAX_CHARS}
                placeholder="Search titles and transcripts…"
                className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
              />
              <button
                type="submit"
                className="rounded bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900"
              >
                Search
              </button>
            </form>

            {query.length > 0 && query.length < SEARCH_MIN_CHARS ? (
              <p className="mt-3 text-sm text-neutral-400">
                Type at least {SEARCH_MIN_CHARS} characters.
              </p>
            ) : null}

            {query.length >= SEARCH_MIN_CHARS ? (
              results.length === 0 ? (
                <p className="mt-3 text-sm text-neutral-400">
                  No matches for &ldquo;{query}&rdquo;.
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-neutral-800">
                  {results.map((r) => {
                    const href =
                      r.segmentIdx === null
                        ? `/dashboard/meetings/${r.meetingId}`
                        : `/dashboard/meetings/${r.meetingId}?seg=${r.segmentIdx}#seg-${r.segmentIdx}`;
                    return (
                      <li key={r.meetingId}>
                        <a href={href} className="block py-3">
                          <span className="flex items-baseline justify-between gap-4">
                            <span className="font-medium">{r.title}</span>
                            <span className="shrink-0 text-xs text-neutral-400">
                              {r.matchedIn === "title"
                                ? "Title match"
                                : formatDuration(r.startMs)}
                              {" · "}
                              {STATUS_LABELS[r.status] ?? r.status}
                            </span>
                          </span>
                          {r.snippet ? (
                            <span className="mt-1 block text-sm text-neutral-400">
                              <Snippet parts={r.snippet} />
                            </span>
                          ) : null}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              )
            ) : null}
          </section>
        ) : null}

        <UploadForm />

        <section className="mt-8">
          <h2 className="text-lg font-medium">Meetings</h2>
          {list.length === 0 ? (
            <p className="mt-3 text-sm text-neutral-400">
              Nothing yet — upload meeting audio to get started.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-neutral-800">
              {list.map((m) => (
                <li key={m.id} className="py-3">
                  <a
                    href={`/dashboard/meetings/${m.id}`}
                    className="flex items-baseline justify-between gap-4"
                  >
                    <span className="font-medium">{m.title}</span>
                    <span className="text-xs text-neutral-400">
                      {STATUS_LABELS[m.status] ?? m.status} ·{" "}
                      {formatDuration(m.durationMs)} ·{" "}
                      {m.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
