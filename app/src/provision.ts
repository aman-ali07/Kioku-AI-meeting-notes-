import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { workspaceMembers, workspaces } from "@/db/schema";

/**
 * Idempotently guarantee a user belongs to at least one workspace, so any
 * signed-in session can resolve a tenant. Called from the auth jwt callback
 * on first sign-in.
 *
 * Race note: without a lock, two concurrent first sign-ins (or two tabs) can
 * create two "Personal" workspaces for one user — harmless-looking today, but
 * a metering/billing bug once usage meters are per-workspace (the user's
 * quota would split across two rows). So: take a per-user transaction-scoped
 * advisory lock, re-check inside the lock, then insert.
 */
export async function ensurePersonalWorkspace(userId: string): Promise<void> {
  const existing = await db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId))
    .limit(1);
  if (existing.length > 0) return;

  await db.transaction(async (tx) => {
    // Advisory lock scoped to this transaction: serializes first-provision
    // per user without cross-user contention (hashtext(userId) collides only
    // for identical hashes, which just means brief mutual exclusion).
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);

    // Re-check under the lock — the winner of the race may have just inserted.
    const inside = await tx
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, userId))
      .limit(1);
    if (inside.length > 0) return;

    const [workspace] = await tx
      .insert(workspaces)
      .values({ name: "Personal", createdBy: userId })
      .returning({ id: workspaces.id });

    if (!workspace) {
      throw new Error("Workspace insert returned no row");
    }

    await tx.insert(workspaceMembers).values({
      workspaceId: workspace.id,
      userId,
      role: "owner",
    });
  });
}
