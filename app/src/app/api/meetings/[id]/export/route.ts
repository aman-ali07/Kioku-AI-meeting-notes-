import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { db } from "@/db/client";
import { meetings, transcriptSegments } from "@/db/schema";
import { authOptions } from "@/auth";
import { getPrimaryWorkspace } from "@/lib/workspace";
import { isUuid } from "@/lib/uuid";
import { storagePathFor } from "@/storage";
import { writeZip } from "@/lib/export-zip";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * One-click full export (GET — plain <a> download, no client JS needed):
 * transcript.txt + metadata.json + the original audio in a single zip. This
 * is the differentiator: on Fireflies, export and auto-delete are paid/
 * Enterprise gates (calibrated 2026-10); on Kioku both ship on the free tier
 * because the AGPL core is never feature-gated.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!session || !userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const primary = await getPrimaryWorkspace(userId);
  if (!primary) {
    return NextResponse.json({ error: "No workspace" }, { status: 403 });
  }
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [meeting] = await db
    .select()
    .from(meetings)
    .where(eq(meetings.id, id))
    .limit(1);
  // Cross-workspace ids and unknown ids are indistinguishable on purpose:
  // don't leak the existence of other tenants' meetings.
  if (!meeting || meeting.workspaceId !== primary.workspace.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const segments = await db
    .select({
      idx: transcriptSegments.idx,
      startMs: transcriptSegments.startMs,
      text: transcriptSegments.text,
      confidence: transcriptSegments.confidence,
    })
    .from(transcriptSegments)
    .where(eq(transcriptSegments.meetingId, id))
    .orderBy(asc(transcriptSegments.idx));

  const createdIso = meeting.createdAt.toISOString();
  const durationSeconds =
    meeting.durationMs === null ? null : Math.round(meeting.durationMs / 1000);
  const fmt = (ms: number) => {
    const total = Math.floor(ms / 1000);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  };

  const transcriptText = [
    `Kioku transcript — ${meeting.title}`,
    `Recorded/queued: ${createdIso}`,
    meeting.durationMs === null
      ? "Duration: unknown"
      : `Duration: ${durationSeconds}s`,
    segments.length === 0
      ? "(no transcript segments)"
      : "",
    ...segments.map(
      (s) => `[${fmt(s.startMs)}] ${s.text} (${s.confidence}%)`,
    ),
  ]
    .filter(Boolean)
    .join("\n");

  let audio: Buffer | undefined;
  let audioNote: string | undefined;
  if (meeting.audioKey) {
    try {
      const path = storagePathFor(meeting.audioKey);
      audio = await readFile(path);
    } catch (error) {
      // A readable record still exports — the transcript is the product.
      console.error("[export] audio read failed:", error);
      audioNote = "original audio file was unavailable at export time";
    }
  } else {
    audioNote = "no audio key recorded for this meeting";
  }

  const zip = writeZip([
    { name: "transcript.txt", data: Buffer.from(transcriptText, "utf8") },
    {
      name: "metadata.json",
      data: Buffer.from(
        JSON.stringify(
          {
            id: meeting.id,
            title: meeting.title,
            status: meeting.status,
            source: meeting.source,
            createdAt: createdIso,
            durationMs: meeting.durationMs,
            segmentCount: segments.length,
            workspace: {
              id: primary.workspace.id,
              name: primary.workspace.name,
              retentionDays: primary.workspace.retentionDays,
            },
            audioNote,
            generatedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        "utf8",
      ),
    },
    ...(audio
      ? [
          {
            // Extension from the stored key; name is ours, not the client's.
            name: `audio.${meeting.audioKey?.split(".").pop() ?? "bin"}`,
            data: audio,
          },
        ]
      : []),
  ]);

  // Attachment filename keeps to [a-z0-9-] (header-injection-proof and
  // filesystem-safe on every OS we'd self-host on).
  const slug =
    meeting.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "meeting";

  return new NextResponse(new Uint8Array(zip), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${slug}-${meeting.id.slice(0, 8)}.zip"`,
      "Content-Length": String(zip.length),
    },
  });
}
