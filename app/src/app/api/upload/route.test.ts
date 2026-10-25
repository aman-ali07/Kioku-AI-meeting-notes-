import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { users, workspaceMembers, workspaces } from "@/db/schema";
import { hasTestDatabase, useTestDatabase } from "@/test-support/database";

const sessionState = vi.hoisted(() => ({ userId: null as string | null }));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(async () =>
    sessionState.userId ? { user: { id: sessionState.userId } } : null,
  ),
}));
vi.mock("@/auth", () => ({ authOptions: {} }));

const describeWithDb = hasTestDatabase ? describe : describe.skip;

function uploadRequest(): NextRequest {
  return new NextRequest("http://localhost/api/upload", { method: "POST" });
}

describeWithDb("POST /api/upload role gate", () => {
  const getClient = useTestDatabase();
  let client: typeof import("@/db/client");
  let POST: (typeof import("./route"))["POST"];
  const createdUsers: string[] = [];
  const createdWorkspaces: string[] = [];

  beforeAll(async () => {
    client = getClient();
    ({ POST } = await import("./route"));
  });

  afterEach(async () => {
    sessionState.userId = null;
    for (const workspaceId of createdWorkspaces.splice(0)) {
      await client.db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    }
    for (const userId of createdUsers.splice(0)) {
      await client.db.delete(users).where(eq(users.id, userId));
    }
  });

  async function createMember(role: "owner" | "member" | "viewer"): Promise<string> {
    const [user] = await client.db
      .insert(users)
      .values({ email: `upload-${randomUUID()}@kioku.test` })
      .returning({ id: users.id });
    if (!user) throw new Error("user insert returned no row");
    createdUsers.push(user.id);

    const [workspace] = await client.db
      .insert(workspaces)
      .values({ name: `upload-${randomUUID()}`, createdBy: user.id })
      .returning({ id: workspaces.id });
    if (!workspace) throw new Error("workspace insert returned no row");
    createdWorkspaces.push(workspace.id);

    await client.db
      .insert(workspaceMembers)
      .values({ workspaceId: workspace.id, userId: user.id, role });
    return user.id;
  }

  it("rejects an unauthenticated request", async () => {
    const response = await POST(uploadRequest());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Not signed in" });
  });

  it("rejects a viewer before reading the body", async () => {
    sessionState.userId = await createMember("viewer");

    const response = await POST(uploadRequest());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Read-only workspace" });
  });

  it("lets an owner through the gate to normal validation", async () => {
    sessionState.userId = await createMember("owner");

    const response = await POST(uploadRequest());

    // No multipart body: a 400 here proves authorization passed.
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Expected multipart/form-data",
    });
  });
});
