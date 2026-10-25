import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import type { WorkspaceRole } from "@/db/schema";
import { workspaceMembers, workspaces } from "@/db/schema";
import { isUuid } from "@/lib/uuid";

export type WorkspaceContext = {
  workspace: typeof workspaces.$inferSelect;
  role: WorkspaceRole;
};

/**
 * Resolve the caller's workspace through `workspace_members`. With no
 * `workspaceId`, the oldest membership wins and equal timestamps fall back to
 * the workspace id — deterministic, unlike the old unordered LIMIT 1.
 *
 * A requested workspace is always checked against membership; a foreign or
 * malformed id returns null (fail closed). The workspace switcher can pass
 * its selected id here once it lands.
 */
export async function getWorkspaceContext(
  userId: string,
  workspaceId?: string | null,
): Promise<WorkspaceContext | null> {
  if (workspaceId != null && !isUuid(workspaceId)) return null;

  const membership = workspaceId
    ? and(
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.workspaceId, workspaceId),
      )
    : eq(workspaceMembers.userId, userId);

  const rows = await db
    .select({ workspace: workspaces, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(membership)
    .orderBy(asc(workspaceMembers.createdAt), asc(workspaceMembers.workspaceId))
    .limit(1);
  return rows[0] ?? null;
}

/** The v1 no-switcher tenant resolution; kept as the call-site name. */
export async function getPrimaryWorkspace(
  userId: string,
): Promise<WorkspaceContext | null> {
  return getWorkspaceContext(userId);
}
