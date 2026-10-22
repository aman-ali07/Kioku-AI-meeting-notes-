import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { workspaceMembers, workspaces } from "@/db/schema";

/**
 * Idempotently guarantee a user belongs to at least one workspace, so any
 * signed-in session can resolve a tenant. Called from the auth jwt callback
 * on first sign-in.
 *
 * Workflow note: concurrent first sign-ins could race insert→workspace here;
 * the (workspace_id, user_id) unique index keeps the result correct (worst
 * case: two "Personal" workspaces, one membership each) — fine for day 1,
 * revisited when invites arrive.
 */
export async function ensurePersonalWorkspace(userId: string): Promise<void> {
  const existing = await db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId))
    .limit(1);

  if (existing.length > 0) return;

  await db.transaction(async (tx) => {
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
