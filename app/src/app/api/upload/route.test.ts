import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { jobs, meetings, users, workspaceMembers, workspaces } from "@/db/schema";
import { hasTestDatabase, useTestDatabase } from "@/test-support/database";

const sessionState = vi.hoisted(() => ({ userId: null as string | null }));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(async () =>
    sessionState.userId ? { user: { id: sessionState.userId } } : null,
  ),
}));
vi.mock("@/auth", () => ({ authOptions: {} }));

const describeWithDb = hasTestDatabase ? describe : describe.skip;

function emptyRequest(): NextRequest {
  return new NextRequest("http://localhost/api/upload", { method: "POST" });
}

function uploadRequest(file: File, title = "Upload test"): NextRequest {
  const form = new FormData();
  form.set("file", file);
  form.set("title", title);
  return new NextRequest("http://localhost/api/upload", {
    method: "POST",
    body: form,
  });
}

function audioFile(name = "meeting.mp3", bytes = [1, 2, 3, 4]): File {
  return new File([new Uint8Array(bytes)], name, { type: "audio/mpeg" });
}

describeWithDb("POST /api/upload", () => {
  const getClient = useTestDatabase();
  let client: typeof import("@/db/client");
  let POST: (typeof import("./route"))["POST"];
  let storageDir: string;
  const createdUsers: string[] = [];
  const createdWorkspaces: string[] = [];

  beforeAll(async () => {
    client = getClient();
    storageDir = await mkdtemp(path.join(tmpdir(), "kioku-upload-"));
    process.env.STORAGE_DIR = storageDir;
    ({ POST } = await import("./route"));
  });

  afterEach(async () => {
    sessionState.userId = null;
    for (const workspaceId of createdWorkspaces.splice(0)) {
      // jobs has no FK to meetings on purpose; delete them explicitly or the
      // worker queue tests would later claim this suite's leftovers.
      await client.db.execute(sql`
        DELETE FROM jobs
         WHERE payload->>'meetingId' IN (
               SELECT id::text FROM meetings WHERE workspace_id = ${workspaceId}
             )
      `);
      await client.db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    }
    for (const userId of createdUsers.splice(0)) {
      await client.db.delete(users).where(eq(users.id, userId));
    }
  });

  afterAll(async () => {
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  async function createMember(
    role: "owner" | "member" | "viewer",
  ): Promise<{ userId: string; workspaceId: string }> {
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
    return { userId: user.id, workspaceId: workspace.id };
  }

  it("rejects an unauthenticated request", async () => {
    const response = await POST(emptyRequest());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Not signed in" });
  });

  it("rejects a viewer before reading the body", async () => {
    sessionState.userId = (await createMember("viewer")).userId;

    const response = await POST(emptyRequest());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Read-only workspace" });
  });

  it("lets an owner through the gate to normal validation", async () => {
    sessionState.userId = (await createMember("owner")).userId;

    const response = await POST(emptyRequest());

    // No multipart body: a 400 here proves authorization passed.
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Expected multipart/form-data",
    });
  });

  it("stores the blob and commits the meeting with its job", async () => {
    const { userId, workspaceId } = await createMember("owner");
    sessionState.userId = userId;

    const response = await POST(
      uploadRequest(audioFile("weekly sync.mp3"), "Weekly sync"),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      meetingId: string;
      sizeBytes: number;
    };
    expect(body.sizeBytes).toBe(4);

    const [meeting] = await client.db
      .select()
      .from(meetings)
      .where(eq(meetings.id, body.meetingId));
    if (!meeting) throw new Error("meeting row missing after a 200");
    expect(meeting.workspaceId).toBe(workspaceId);
    expect(meeting.status).toBe("queued");
    expect(meeting.source).toBe("upload");
    expect(meeting.title).toBe("Weekly sync");
    expect(meeting.audioKey).toBe(`${workspaceId}/${body.meetingId}.mp3`);
    expect(meeting.createdBy).toBe(userId);

    const [job] = await client.db
      .select()
      .from(jobs)
      .where(sql`${jobs.payload}->>'meetingId' = ${body.meetingId}`);
    expect(job?.kind).toBe("transcribe");

    const info = await stat(path.join(storageDir, meeting.audioKey!));
    expect(info.size).toBe(4);
  });

  it("rolls back the meeting and deletes the blob when the job insert fails", async () => {
    const { userId, workspaceId } = await createMember("owner");
    sessionState.userId = userId;
    const marker = `inject-jobs-failure-${randomUUID()}`;

    // Real failure injection: only this upload's job insert raises, so other
    // tests running against the same database are unaffected.
    await client.sql.unsafe(`
      CREATE OR REPLACE FUNCTION upload_test_fail_jobs() RETURNS trigger AS $$
      BEGIN
        IF NEW.payload->>'meetingId' IN (
          SELECT id::text FROM meetings WHERE title = '${marker}'
        ) THEN
          RAISE EXCEPTION 'injected jobs failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await client.sql.unsafe(`
      CREATE TRIGGER upload_test_fail_jobs
      BEFORE INSERT ON jobs
      FOR EACH ROW EXECUTE FUNCTION upload_test_fail_jobs()
    `);

    try {
      const response = await POST(uploadRequest(audioFile(), marker));

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Upload failed" });

      const meetingsInWorkspace = await client.db
        .select({ id: meetings.id })
        .from(meetings)
        .where(eq(meetings.workspaceId, workspaceId));
      expect(meetingsInWorkspace).toEqual([]);

      const files = await readdir(path.join(storageDir, workspaceId)).catch(
        () => [],
      );
      expect(files).toEqual([]);
    } finally {
      await client.sql.unsafe(
        "DROP TRIGGER IF EXISTS upload_test_fail_jobs ON jobs",
      );
      await client.sql.unsafe("DROP FUNCTION IF EXISTS upload_test_fail_jobs()");
    }
  });

  it("rejects a declared oversize body before buffering it", async () => {
    const { userId, workspaceId } = await createMember("owner");
    sessionState.userId = userId;

    const response = await POST(
      new NextRequest("http://localhost/api/upload", {
        method: "POST",
        headers: { "content-length": String(52 * 1024 * 1024) },
      }),
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: "File too large (max 50 MB)",
    });
    const files = await readdir(path.join(storageDir, workspaceId)).catch(
      () => [],
    );
    expect(files).toEqual([]);
  });
});
