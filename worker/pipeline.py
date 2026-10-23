"""Kioku transcription pipeline — the Days 4–6 queue consumer.

Single-process loop (spec decision):
  1. Lease-watchdog: requeue `processing` jobs whose lease (locked_at) is
     stale (>15 min) — a worker that died mid-job can't starve the queue.
  2. Claim one job atomically: UPDATE ... WHERE id = (SELECT ... FOR UPDATE
     SKIP LOCKED LIMIT 1 RETURNING ...). Safe with future multiple workers.
  3. Process: resolve meeting → probe duration (PyAV) → faster-whisper
     small/int8 (CPU) → insert transcript_segments → degenerate-output filter
     (post-ASR, pre-summary: mean confidence + repetition) → meeting status.

Engine runs local and free on the free tier; the paid Groq path arrives with
the billing milestone and is selected per-workspace there (no config yet).
"""

import json
import math
import os
import sys
import time
import unicodedata
from collections import Counter

import av  # PyAV — bundled FFmpeg libs; also faster-whisper's decoder
import psycopg
from dotenv import load_dotenv

load_dotenv()  # worker/.env; real process env always wins

DATABASE_URL = os.environ.get("DATABASE_URL")
STORAGE_DIR = os.environ.get("STORAGE_DIR")
if not DATABASE_URL or not STORAGE_DIR:
    raise SystemExit(
        "FATAL: DATABASE_URL and STORAGE_DIR must be set (worker/.env)"
    )

MODEL_SIZE = os.environ.get("WHISPER_MODEL", "small")
POLL_SECONDS = 2.0
LEASE_STALE_SECONDS = 15 * 60
MAX_ATTEMPTS = 3
# Degenerate-output guardrails (accepted post-ASR, before any summary spend):
MEAN_CONF_MIN = 0.5
REPEAT_LIMIT = 8  # same exact line repeated more than this => hallucination loop
MAX_EMPTY_RATIO = 0.9  # mostly empty segments => nothing usable


def connect():
    return psycopg.connect(DATABASE_URL, autocommit=True)


def requeue_stale_leases(conn: psycopg.Connection) -> int:
    """Jobs whose worker died (lease older than LEASE_STALE_SECONDS) go back
    to the queue, attempts already counted. Returns requeued count."""
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE jobs
               SET status = 'queued', locked_at = NULL
             WHERE status = 'processing'
               AND locked_at < now() - interval '%s seconds'
            RETURNING id
            """,
            (LEASE_STALE_SECONDS,),
        )
        return len(cur.fetchall())


def claim_job(conn: psycopg.Connection):
    """Atomically lease one queued job; None when the queue is empty."""
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE jobs
               SET status = 'processing',
                   locked_at = now(),
                   attempts = attempts + 1
             WHERE id = (
                   SELECT id FROM jobs
                    WHERE status = 'queued'
                    ORDER BY created_at
                    LIMIT 1
                    FOR UPDATE SKIP LOCKED
                   )
            RETURNING id, kind, payload
            """
        )
        return cur.fetchone()


def finish_job(conn: psycopg.Connection, job_id: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE jobs SET status = 'done', locked_at = NULL WHERE id = %s",
            (job_id,),
        )


def fail_job(conn: psycopg.Connection, job_id: str, attempts: int, error: str) -> None:
    """Terminal failure past MAX_ATTEMPTS; otherwise back to the queue."""
    with conn.cursor() as cur:
        if attempts >= MAX_ATTEMPTS:
            cur.execute(
                """
                UPDATE jobs
                   SET status = 'failed', locked_at = NULL, last_error = %s
                 WHERE id = %s
                """,
                (error[:500], job_id),
            )
            # The meeting has no usable transcript — reflect it in the UI.
            cur.execute(
                """
                UPDATE meetings
                   SET status = 'failed'
                 WHERE id = (SELECT (payload->>'meetingId')::uuid FROM jobs WHERE id = %s)
                """,
                (job_id,),
            )
        else:
            cur.execute(
                """
                UPDATE jobs
                   SET status = 'queued', locked_at = NULL, last_error = %s
                 WHERE id = %s
                """,
                (error[:500], job_id),
            )


def set_meeting_status(conn: psycopg.Connection, meeting_id: str, status: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE meetings SET status = %s WHERE id = %s", (status, meeting_id)
        )


def audio_duration_seconds(path: str) -> float:
    """Container duration in seconds; falls back to the audio stream."""
    with av.open(path) as container:
        if container.duration:
            # PyAV exposes container.duration in AV_TIME_BASE units (µs).
            return container.duration / 1_000_000
        for stream in container.streams.audio:
            if stream.duration and stream.time_base:
                seconds = float(stream.duration * stream.time_base)
                return seconds
    raise RuntimeError("no audio duration found (is this file audio?)")


# ---------------------------------------------------------------------------
# Degenerate-output filter — hallucinated loops and silence mush must not
# become "completed" transcripts (post-ASR, pre-summary; audit finding #1).
# ---------------------------------------------------------------------------

def is_degenerate(mean_conf: float, texts: list[str]) -> bool:
    if not texts:
        return True
    if mean_conf < MEAN_CONF_MIN:
        return True
    normalized = [
        unicodedata.normalize("NFKC", t).strip().lower() for t in texts
    ]
    repeats = Counter(t for t in normalized if t)
    if repeats and repeats.most_common(1)[0][1] > REPEAT_LIMIT:
        return True
    if sum(1 for t in normalized if not t) / len(normalized) > MAX_EMPTY_RATIO:
        return True
    return False


_model = None  # loaded once per process; ~460 MB RAM for small/int8


def get_model():
    global _model
    if _model is None:
        from faster_whisper import WhisperModel

        print(f"[pipeline] loading WhisperModel({MODEL_SIZE!r}, cpu, int8)…", flush=True)
        _model = WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8")
    return _model


def process_job(conn: psycopg.Connection, job_id: str, payload: dict) -> None:
    meeting_id = (payload or {}).get("meetingId")
    if not meeting_id:
        raise RuntimeError("job payload missing meetingId")

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT workspace_id, audio_key
              FROM meetings
             WHERE id = %s AND audio_key IS NOT NULL
            """,
            (meeting_id,),
        )
        row = cur.fetchone()
    if not row:
        raise RuntimeError(f"meeting {meeting_id} not found or has no audio_key")

    _workspace_id, audio_key = row
    if ".." in audio_key or audio_key.startswith("/"):
        raise RuntimeError(f"unsafe audio key: {audio_key[:48]}…")
    path = os.path.join(STORAGE_DIR, audio_key)
    if not os.path.isfile(path):
        raise RuntimeError(f"audio missing on disk: {audio_key}")

    set_meeting_status(conn, meeting_id, "processing")

    duration = audio_duration_seconds(path)
    model = get_model()
    segments, info = model.transcribe(path, vad_filter=True)

    rows = []
    confs = []
    for idx, seg in enumerate(segments):
        text = seg.text.strip()
        conf = math.exp(seg.avg_logprob) if seg.avg_logprob is not None else 0.0
        confs.append(conf)
        rows.append(
            (meeting_id, idx, int(seg.start * 1000), int(seg.end * 1000), text, int(conf * 100))
        )

    # Re-runs (after a lease expiry) would collide with the unique (meeting_id,
    # idx) — replace the segment set wholesale, then stamp the meeting.
    status = _status_for(rows, confs)
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM transcript_segments WHERE meeting_id = %s", (meeting_id,)
        )
        if rows:
            cur.executemany(
                """
                INSERT INTO transcript_segments
                     (meeting_id, idx, start_ms, end_ms, text, confidence)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                rows,
            )
        cur.execute(
            "UPDATE meetings SET status = %s, duration_ms = %s WHERE id = %s",
            (status, int(duration * 1000), meeting_id),
        )


def _status_for(rows, confs) -> str:
    """completed when the output looks sane; low_confidence otherwise."""
    if not rows:
        return "low_confidence"
    mean_conf = sum(confs) / len(confs)
    if is_degenerate(mean_conf, [r[4] for r in rows]):
        return "low_confidence"
    return "completed"


def run_purge(conn: psycopg.Connection) -> int:
    """Retention purge — the differentiator (spec: Fireflies hides auto-delete
    behind Enterprise and exports behind paid tiers; Kioku ships both free).

    Deletes audio on disk + meeting rows (segments cascade via FK) whose age
    exceeds the workspace's retention_days policy. Deliberately excludes
    queued/processing meetings: a purge must never race an active claim, so a
    meeting being published right now is untouched even at retention_days=0.
    Queued jobs of purged meetings are deleted outright (nothing left to
    claim — a claim on a purged meeting could only fail); terminal job rows
    stay as the record that a pipeline ran.

    Returns the number of meetings purged. Failure is per-file best-effort:
    one unreadable path must not block the sweep (logged, not swallowed
    silently — every cleanup error prints).
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT m.id, m.audio_key
              FROM meetings m
              JOIN workspaces w ON w.id = m.workspace_id
             WHERE m.status IN ('uploaded', 'completed', 'low_confidence', 'failed')
               AND m.created_at < now() - make_interval(days => w.retention_days)
            """
        )
        victims = cur.fetchall()

    purged = 0
    for meeting_id, audio_key in victims:
        with conn.cursor() as cur:
            cur.execute(
                """
                DELETE FROM jobs
                 WHERE status = 'queued'
                   AND payload->>'meetingId' = %s::text
                """,
                (str(meeting_id),),
            )
            if audio_key:
                if ".." not in audio_key and not audio_key.startswith("/"):
                    path = os.path.join(STORAGE_DIR, audio_key)
                    try:
                        os.remove(path)
                    except FileNotFoundError:
                        pass  # already gone — nothing to purge (fs is our ledger)
                    except OSError as exc:
                        # Don't drop the DB row while its blob still exists —
                        # fail this file loudly; only file-reads partly removed
                        print(f"[purge] could not remove {path}: {exc}", flush=True)
                        continue
                else:
                    print(f"[purge] skipped unsafe key: {audio_key[:48]}…", flush=True)
                    continue
            cur.execute("DELETE FROM meetings WHERE id = %s", (meeting_id,))
        purged += 1
    return purged


PURGE_INTERVAL_SECONDS = 3600  # hourly sweep — retention is audit-cheap


def main() -> None:
    if "--purge-once" in sys.argv:
        # Manual/ops mode: one sweep and exit (future self-host cron users).
        purge_conn = connect()
        try:
            count = run_purge(purge_conn)
            print(f"[purge] one-shot removed {count} meeting(s)", flush=True)
        finally:
            purge_conn.close()
        return

    print(f"[pipeline] started (model={MODEL_SIZE}, storage={STORAGE_DIR})", flush=True)
    conn = connect()
    last_purge = 0.0
    try:
        while True:
            requeued = requeue_stale_leases(conn)
            if requeued:
                print(f"[pipeline] requeued {requeued} stale-lease job(s)", flush=True)

            if time.time() - last_purge >= PURGE_INTERVAL_SECONDS:
                purged = run_purge(conn)
                if purged:
                    print(f"[purge] removed {purged} meeting(s) per retention policy", flush=True)
                last_purge = time.time()

            job = claim_job(conn)
            if job is None:
                time.sleep(POLL_SECONDS)
                continue

            job_id, kind, payload = job
            attempts = 1  # claim incremented it; re-read for accuracy
            with conn.cursor() as cur:
                cur.execute("SELECT attempts FROM jobs WHERE id = %s", (job_id,))
                attempts = cur.fetchone()[0]
            print(f"[pipeline] claimed {kind} job {job_id} (attempt {attempts})", flush=True)

            try:
                if kind != "transcribe":
                    raise RuntimeError(f"unknown job kind: {kind}")
                process_job(conn, job_id, payload if isinstance(payload, dict) else json.loads(payload))
                finish_job(conn, job_id)
                print(f"[pipeline] job {job_id} done", flush=True)
            except Exception as exc:  # noqa: BLE001 — worker must survive any bad job
                print(f"[pipeline] job {job_id} attempt {attempts} failed: {exc}", flush=True)
                fail_job(conn, job_id, attempts, str(exc))
    finally:
        conn.close()


if __name__ == "__main__":
    main()
