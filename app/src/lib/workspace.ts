import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { workspaceMembers, workspaces } from "@/db/schema";

/**
 * The user's primary workspace — v1 has no switcher (invites/switching land
 * with the Days 8–13 milestone), so "first membership" is the honest tenant
 * resolution for both the dashboard and upload flows.
 */
export async function getPrimaryWorkspace(userId: string) {
  const rows = await db
    .select({ workspace: workspaces, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}
