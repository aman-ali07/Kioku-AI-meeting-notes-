import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { desc, eq } from "drizzle-orm";
import { authOptions } from "@/auth";
import { db } from "@/db/client";
import { meetings } from "@/db/schema";
import { getPrimaryWorkspace } from "@/lib/workspace";
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

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!session || !userId) {
    // A session without a user id is malformed (stale token, broken config) —
    // treat it as signed out rather than querying a tenant on an empty id.
    redirect("/login?callbackUrl=/dashboard");
  }
  const primary = await getPrimaryWorkspace(userId);
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
