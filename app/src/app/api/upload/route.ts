import { promises as fs } from "node:fs";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { db } from "@/db/client";
import { jobs, meetings } from "@/db/schema";
import { authOptions } from "@/auth";
import { requireEnv } from "@/env";
import { getPrimaryWorkspace } from "@/lib/workspace";
import { deleteStorageObject, putStorageObject } from "@/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Generous for a 1-hour meeting at speech bitrates; the ground-truth disk
// check in putStorageObject backstops browser-reported sizes anyway.
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

// What faster-whisper (PyAV) can decode. Types vary by browser/OS (m4a is
// audio/mp4 on some, audio/x-m4a on others), so this is an allowlist, not one
// constant. The extension allowlist is what keys the stored file.
const ALLOWED_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/x-m4a",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/webm",
  "video/webm",
  "video/mp4",
];
const ALLOWED_EXTENSIONS = ["mp3", "m4a", "wav", "webm", "mp4", "ogg"] as const;

/** Strip control characters, trim, and cap so titles can't smuggle junk. */
function sanitizeTitle(raw: string): string {
  return raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 120);
}

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!session || !userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const primary = await getPrimaryWorkspace(userId);
  if (!primary) {
    // Fail closed: without a tenant there is nowhere legal to attach the file.
    return NextResponse.json({ error: "No workspace" }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return badRequest("Expected multipart/form-data");
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return badRequest('Missing "file" field');
  }
  if (file.size === 0) {
    return badRequest("Empty file");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "File too large (max 50 MB)" },
      { status: 413 },
    );
  }

  const extension = file.name.split(".").pop()?.toLowerCase();
  if (
    !extension ||
    !ALLOWED_EXTENSIONS.includes(extension as (typeof ALLOWED_EXTENSIONS)[number])
  ) {
    return badRequest(
      `Unsupported file type (allowed: ${ALLOWED_EXTENSIONS.join(", ")})`,
    );
  }
  if (file.type && !ALLOWED_TYPES.includes(file.type)) {
    return badRequest("Unsupported audio format");
  }

  const title =
    sanitizeTitle(String(form.get("title") ?? "")) ||
    sanitizeTitle(file.name.replace(/\.[^.]+$/, "")) ||
    "Untitled recording";

  // Keys are generated here — the client filename never names stored objects.
  const meetingId = crypto.randomUUID();
  const audioKey = `${primary.workspace.id}/${meetingId}.${extension}`;

  try {
    const { size } = await putStorageObject(audioKey, file.stream());
    if (size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: "File too large (max 50 MB)" },
        { status: 413 },
      );
    }
    if (size === 0) {
      await deleteStorageObject(audioKey);
      return badRequest("Empty file");
    }

    const [meeting] = await db
      .insert(meetings)
      .values({
        id: meetingId,
        workspaceId: primary.workspace.id,
        title,
        status: "queued",
        source: "upload",
        audioKey,
        createdBy: userId,
        startedAt: new Date(),
      })
      .returning({ id: meetings.id });

    if (!meeting) {
      throw new Error("Meeting insert returned no row");
    }

    await db.insert(jobs).values({
      kind: "transcribe",
      payload: { meetingId },
    });

    return NextResponse.json({ meetingId, sizeBytes: size });
  } catch (error) {
    // Don't leave an orphan audio file behind when the DB path failed.
    await deleteStorageObject(audioKey).catch((cleanup) => {
      console.error("[upload] orphan-file cleanup failed:", cleanup);
    });
    console.error("[upload] failed:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}

/** Existence probe so clients/tests can confirm the route is mounted. */
export async function GET() {
  requireEnv("STORAGE_DIR");
  return NextResponse.json({ ok: true, maxBytes: MAX_UPLOAD_BYTES });
}
