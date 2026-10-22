import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { getPrimaryWorkspace } from "@/lib/workspace";
import { SignOutButton } from "@/components/sign-out-button";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!session || !userId) {
    // A session without a user id is malformed (stale token, broken config) —
    // treat it as signed out rather than querying a tenant on an empty id.
    redirect("/login?callbackUrl=/dashboard");
  }
  const primary = await getPrimaryWorkspace(userId);

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
      </div>
    </main>
  );
}
