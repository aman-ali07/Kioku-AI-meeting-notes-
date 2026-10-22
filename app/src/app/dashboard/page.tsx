import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { eq } from "drizzle-orm";
import { authOptions } from "@/auth";
import { db } from "@/db/client";
import { workspaceMembers, workspaces } from "@/db/schema";
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

  const memberships = await db
    .select({ workspace: workspaces, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .limit(1);

  const membership = memberships[0];

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-20">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Kioku</h1>
        <SignOutButton />
      </header>

      <section className="flex flex-col gap-4 rounded-lg border border-neutral-800 bg-neutral-900/50 p-6">
        <p className="text-sm text-neutral-400">
          Signed in as{" "}
          <span className="font-mono text-neutral-100">
            {session.user?.email ?? userId}
          </span>
        </p>
        {membership ? (
          <div className="flex flex-col gap-1">
            <p className="text-lg font-medium">{membership.workspace.name}</p>
            <p className="text-sm text-neutral-400">
              Your role: <span className="text-neutral-200">{membership.role}</span>
              {" · "}plan:{" "}
              <span className="text-neutral-200">
                {membership.workspace.billingPlan}
              </span>
              {" · "}retention:{" "}
              <span className="text-neutral-200">
                {membership.workspace.retentionDays} days
              </span>
            </p>
          </div>
        ) : (
          <p className="text-sm text-amber-400">
            No workspace found for your account — sign out and in again to
            re-run provisioning.
          </p>
        )}
      </section>

      <p className="text-sm text-neutral-500">
        Meetings, transcripts, and summaries arrive with the Days 4–6 milestone
        (upload + pipeline + worker).
      </p>
    </main>
  );
}
