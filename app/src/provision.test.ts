import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { users, workspaceMembers, workspaces } from "@/db/schema";
import { hasTestDatabase, useTestDatabase } from "@/test-support/database";

const describeWithDb = hasTestDatabase ? describe : describe.skip;

describeWithDb("ensurePersonalWorkspace retention", () => {
  const getClient = useTestDatabase();
  let client: typeof import("@/db/client");
  let ensurePersonalWorkspace: (typeof import("@/provision"))["ensurePersonalWorkspace"];
  const createdUsers: string[] = [];
  const createdWorkspaces: string[] = [];

  beforeAll(async () => {
    client = getClient();
    ({ ensurePersonalWorkspace } = await import("@/provision"));
  });

  afterEach(async () => {
    delete process.env.DEFAULT_RETENTION_DAYS;
    for (const workspaceId of createdWorkspaces.splice(0)) {
      await client.db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    }
    for (const userId of createdUsers.splice(0)) {
      await client.db.delete(users).where(eq(users.id, userId));
    }
  });

  async function createUser(): Promise<string> {
    const [user] = await client.db
      .insert(users)
      .values({ email: `retention-${randomUUID()}@kioku.test` })
      .returning({ id: users.id });
    if (!user) throw new Error("user insert returned no row");
    createdUsers.push(user.id);
    return user.id;
  }

  async function workspaceFor(userId: string) {
    const [row] = await client.db
      .select({
        id: workspaces.id,
        retentionDays: workspaces.retentionDays,
      })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(eq(workspaceMembers.userId, userId));
    return row ?? null;
  }

  it("leaves retention NULL when DEFAULT_RETENTION_DAYS is unset (self-host)", async () => {
    const userId = await createUser();
    await ensurePersonalWorkspace(userId);

    const workspace = await workspaceFor(userId);
    expect(workspace).not.toBeNull();
    createdWorkspaces.push(workspace!.id);
    expect(workspace!.retentionDays).toBeNull();
  });

  it("applies DEFAULT_RETENTION_DAYS when configured (cloud free)", async () => {
    process.env.DEFAULT_RETENTION_DAYS = "90";
    const userId = await createUser();
    await ensurePersonalWorkspace(userId);

    const workspace = await workspaceFor(userId);
    expect(workspace).not.toBeNull();
    createdWorkspaces.push(workspace!.id);
    expect(workspace!.retentionDays).toBe(90);
  });

  it("fails closed on a malformed DEFAULT_RETENTION_DAYS", async () => {
    process.env.DEFAULT_RETENTION_DAYS = "9O";
    const userId = await createUser();

    await expect(ensurePersonalWorkspace(userId)).rejects.toThrow(
      /expected a positive integer/,
    );
    const workspace = await workspaceFor(userId);
    if (workspace) createdWorkspaces.push(workspace.id);
    expect(workspace).toBeNull();
  });
});
