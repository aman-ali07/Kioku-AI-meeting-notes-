import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { users, workspaceMembers, workspaces } from "@/db/schema";
import { hasTestDatabase, useTestDatabase } from "@/test-support/database";

const describeWithDb = hasTestDatabase ? describe : describe.skip;

describeWithDb("workspace resolution", () => {
  const getClient = useTestDatabase();
  let client: typeof import("@/db/client");
  let getWorkspaceContext: (typeof import("./workspace"))["getWorkspaceContext"];
  let getPrimaryWorkspace: (typeof import("./workspace"))["getPrimaryWorkspace"];
  const createdUsers: string[] = [];
  const createdWorkspaces: string[] = [];

  beforeAll(async () => {
    client = getClient();
    ({ getWorkspaceContext, getPrimaryWorkspace } = await import("./workspace"));
  });

  afterEach(async () => {
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
      .values({ email: `workspace-${randomUUID()}@kioku.test` })
      .returning({ id: users.id });
    if (!user) throw new Error("user insert returned no row");
    createdUsers.push(user.id);
    return user.id;
  }

  async function createWorkspace(createdBy: string | null): Promise<string> {
    const [workspace] = await client.db
      .insert(workspaces)
      .values({ name: `workspace-${randomUUID()}`, createdBy })
      .returning({ id: workspaces.id });
    if (!workspace) throw new Error("workspace insert returned no row");
    createdWorkspaces.push(workspace.id);
    return workspace.id;
  }

  async function addMember(
    workspaceId: string,
    userId: string,
    role: "owner" | "member" | "viewer",
    createdAt: Date,
  ): Promise<void> {
    await client.db
      .insert(workspaceMembers)
      .values({ workspaceId, userId, role, createdAt });
  }

  it("returns the explicitly requested workspace when the caller is a member", async () => {
    const userId = await createUser();
    const older = await createWorkspace(userId);
    const newer = await createWorkspace(userId);
    await addMember(older, userId, "owner", new Date("2026-01-01T00:00:00Z"));
    await addMember(newer, userId, "viewer", new Date("2026-02-01T00:00:00Z"));

    const context = await getWorkspaceContext(userId, newer);

    expect(context?.workspace.id).toBe(newer);
    expect(context?.role).toBe("viewer");
  });

  it("refuses a workspace the caller does not belong to", async () => {
    const member = await createUser();
    const stranger = await createUser();
    const memberWorkspace = await createWorkspace(member);
    const foreignWorkspace = await createWorkspace(stranger);
    await addMember(memberWorkspace, member, "owner", new Date("2026-01-01"));
    await addMember(foreignWorkspace, stranger, "owner", new Date("2026-01-01"));

    expect(await getWorkspaceContext(member, foreignWorkspace)).toBeNull();
  });

  it("refuses malformed ids before they reach Postgres", async () => {
    const userId = await createUser();
    const workspaceId = await createWorkspace(userId);
    await addMember(workspaceId, userId, "owner", new Date("2026-01-01"));

    expect(await getWorkspaceContext(userId, "not-a-uuid")).toBeNull();
    expect(
      await getWorkspaceContext(userId, "00000000-0000-4000-8000-00000000000g"),
    ).toBeNull();
  });

  it("falls back to the oldest membership when no id is given", async () => {
    const userId = await createUser();
    const older = await createWorkspace(userId);
    const newer = await createWorkspace(userId);
    await addMember(newer, userId, "owner", new Date("2026-02-01T00:00:00Z"));
    await addMember(older, userId, "member", new Date("2026-01-01T00:00:00Z"));

    const context = await getPrimaryWorkspace(userId);

    expect(context?.workspace.id).toBe(older);
    expect(context?.role).toBe("member");
  });

  it("breaks equal created_at ties by workspace id", async () => {
    const userId = await createUser();
    const createdAt = new Date("2026-01-01T00:00:00Z");
    // Random ids, sorted at runtime: the tie-break must not depend on insert
    // order, and hardcoding ids would collide across failed runs.
    const [lower, higher] = [randomUUID(), randomUUID()].sort();
    await client.db.insert(workspaces).values([
      { id: higher, name: "higher", createdBy: userId },
      { id: lower, name: "lower", createdBy: userId },
    ]);
    createdWorkspaces.push(lower, higher);
    await addMember(higher, userId, "owner", createdAt);
    await addMember(lower, userId, "member", createdAt);

    const context = await getPrimaryWorkspace(userId);

    expect(context?.workspace.id).toBe(lower);
  });

  it("returns null for a user with no memberships", async () => {
    const userId = await createUser();

    expect(await getPrimaryWorkspace(userId)).toBeNull();
  });
});
