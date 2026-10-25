import type { WorkspaceRole } from "@/db/schema";

/** Viewers can read (dashboard, search, export) but cannot mutate workspace data. */
export function canWriteToWorkspace(role: WorkspaceRole): boolean {
  return role === "owner" || role === "member";
}
