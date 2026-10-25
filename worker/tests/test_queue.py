import json
import uuid
from datetime import datetime, timedelta, timezone

import psycopg
import pytest

import pipeline


def _stale_lock() -> datetime:
    return datetime.now(timezone.utc) - timedelta(
        seconds=pipeline.LEASE_STALE_SECONDS + 60
    )


def _job_state(conn, job_id: str):
    with conn.cursor() as cur:
        cur.execute(
            "SELECT status, attempts, locked_at, last_error FROM jobs WHERE id = %s",
            (job_id,),
        )
        status, attempts, locked_at, last_error = cur.fetchone()
    return {
        "status": status,
        "attempts": attempts,
        "locked_at": locked_at,
        "last_error": last_error,
    }


def _meeting_status(conn, meeting_id: str) -> str:
    with conn.cursor() as cur:
        cur.execute("SELECT status FROM meetings WHERE id = %s", (meeting_id,))
        return cur.fetchone()[0]


def _segment_texts(conn, meeting_id: str) -> list[str]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT text FROM transcript_segments WHERE meeting_id = %s ORDER BY idx",
            (meeting_id,),
        )
        return [row[0] for row in cur.fetchall()]


class QueueRows:
    """Row factories for one queue test, on an autocommit (production-shaped)
    connection. All rows carry a unique workspace-name prefix so a crashed
    prior run's debris is removed before and after each test."""

    PREFIX = "queue-test-"

    def __init__(self, conn: psycopg.Connection):
        self.conn = conn

    def reset(self) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                """
                DELETE FROM jobs
                 WHERE payload->>'meetingId' IN (
                       SELECT m.id::text
                         FROM meetings m
                         JOIN workspaces w ON w.id = m.workspace_id
                        WHERE w.name LIKE %s
                       )
                """,
                (f"{self.PREFIX}%",),
            )
            cur.execute(
                "DELETE FROM workspaces WHERE name LIKE %s",
                (f"{self.PREFIX}%",),
            )

    def workspace(self) -> str:
        with self.conn.cursor() as cur:
            cur.execute(
                "INSERT INTO workspaces (name) VALUES (%s) RETURNING id",
                (f"{self.PREFIX}{uuid.uuid4()}",),
            )
            return cur.fetchone()[0]

    def meeting(
        self,
        workspace_id: str,
        status: str = "queued",
        *,
        audio_key: str | None = "queue-test/audio.wav",
    ) -> str:
        with self.conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO meetings (workspace_id, title, status, audio_key)
                VALUES (%s, %s, %s, %s)
                RETURNING id
                """,
                (workspace_id, "queue test", status, audio_key),
            )
            return cur.fetchone()[0]

    def job(
        self,
        meeting_id: str,
        *,
        kind: str = "transcribe",
        status: str = "processing",
        attempts: int = 1,
        locked_at: datetime | None = None,
    ) -> str:
        if locked_at is None and status == "processing":
            locked_at = datetime.now(timezone.utc)
        with self.conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO jobs (kind, payload, status, attempts, locked_at)
                VALUES (%s, %s::jsonb, %s, %s, %s)
                RETURNING id
                """,
                (
                    kind,
                    json.dumps({"meetingId": str(meeting_id)}),
                    status,
                    attempts,
                    locked_at,
                ),
            )
            return cur.fetchone()[0]


@pytest.fixture()
def queue(autocommit_conn):
    rows = QueueRows(autocommit_conn)
    rows.reset()
    try:
        yield rows
    finally:
        rows.reset()


def test_stale_lease_below_cap_requeues_and_resets_meeting(queue):
    meeting = queue.meeting(queue.workspace(), "processing")
    job = queue.job(meeting, attempts=1, locked_at=_stale_lock())

    assert pipeline.requeue_stale_leases(queue.conn) == (1, 0)

    state = _job_state(queue.conn, job)
    assert state["status"] == "queued"
    assert state["locked_at"] is None
    assert state["attempts"] == 1
    assert _meeting_status(queue.conn, meeting) == "queued"


def test_stale_lease_at_cap_fails_terminally(queue):
    meeting = queue.meeting(queue.workspace(), "processing")
    job = queue.job(
        meeting,
        attempts=pipeline.MAX_ATTEMPTS,
        locked_at=_stale_lock(),
    )

    assert pipeline.requeue_stale_leases(queue.conn) == (0, 1)

    state = _job_state(queue.conn, job)
    assert state["status"] == "failed"
    assert state["locked_at"] is None
    assert state["last_error"] == "lease expired"
    assert _meeting_status(queue.conn, meeting) == "failed"


def test_fresh_processing_lease_is_untouched(queue):
    meeting = queue.meeting(queue.workspace(), "processing")
    job = queue.job(meeting, attempts=1)

    assert pipeline.requeue_stale_leases(queue.conn) == (0, 0)

    assert _job_state(queue.conn, job)["status"] == "processing"
    assert _meeting_status(queue.conn, meeting) == "processing"


def test_claim_job_returns_the_incremented_attempt(queue):
    meeting = queue.meeting(queue.workspace(), "queued")
    job = queue.job(meeting, status="queued", attempts=1, locked_at=None)

    claimed = pipeline.claim_job(queue.conn)

    assert claimed is not None
    assert claimed[0] == job
    assert claimed[3] == 2
    assert _job_state(queue.conn, job)["status"] == "processing"


def test_fail_job_retry_requeues_and_resets_meeting(queue):
    meeting = queue.meeting(queue.workspace(), "processing")
    job = queue.job(meeting, attempts=1)

    pipeline.fail_job(queue.conn, job, 1, "temporary")

    state = _job_state(queue.conn, job)
    assert state["status"] == "queued"
    assert state["locked_at"] is None
    assert state["last_error"] == "temporary"
    assert _meeting_status(queue.conn, meeting) == "queued"


def test_fail_job_terminal_fails_transcribe_meeting(queue):
    meeting = queue.meeting(queue.workspace(), "processing")
    job = queue.job(meeting, attempts=pipeline.MAX_ATTEMPTS)

    pipeline.fail_job(queue.conn, job, pipeline.MAX_ATTEMPTS, "boom")

    assert _job_state(queue.conn, job)["status"] == "failed"
    assert _meeting_status(queue.conn, meeting) == "failed"


def test_fail_job_keeps_an_already_completed_meeting(queue):
    meeting = queue.meeting(queue.workspace(), "completed")
    job = queue.job(meeting, attempts=pipeline.MAX_ATTEMPTS)

    pipeline.fail_job(queue.conn, job, pipeline.MAX_ATTEMPTS, "late failure")

    assert _job_state(queue.conn, job)["status"] == "failed"
    assert _meeting_status(queue.conn, meeting) == "completed"


def test_fail_job_non_transcribe_does_not_touch_meeting(queue):
    meeting = queue.meeting(queue.workspace(), "processing")
    job = queue.job(meeting, kind="summarize", attempts=pipeline.MAX_ATTEMPTS)

    pipeline.fail_job(queue.conn, job, pipeline.MAX_ATTEMPTS, "summarizer down")

    assert _job_state(queue.conn, job)["status"] == "failed"
    assert _meeting_status(queue.conn, meeting) == "processing"


def test_fail_job_does_not_resurrect_a_finished_job(queue):
    meeting = queue.meeting(queue.workspace(), "completed")
    job = queue.job(
        meeting,
        status="done",
        attempts=pipeline.MAX_ATTEMPTS,
        locked_at=None,
    )

    pipeline.fail_job(queue.conn, job, pipeline.MAX_ATTEMPTS, "late failure")

    assert _job_state(queue.conn, job)["status"] == "done"
    assert _meeting_status(queue.conn, meeting) == "completed"


def test_write_transcript_rolls_back_a_partial_insert(queue):
    meeting = queue.meeting(queue.workspace(), "completed")
    with queue.conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO transcript_segments
                 (meeting_id, idx, start_ms, end_ms, text)
            VALUES (%s, 0, 0, 1000, 'old transcript')
            """,
            (meeting,),
        )

    # Duplicate idx violates the unique (meeting_id, idx) index on the second
    # row: the DELETE and first INSERT must roll back with it.
    rows = [
        (meeting, 0, 0, 1000, "new a", 90),
        (meeting, 0, 1000, 2000, "new b", 90),
    ]
    with pytest.raises(psycopg.errors.UniqueViolation):
        pipeline._write_transcript(queue.conn, meeting, rows, "completed", 2000)

    assert _segment_texts(queue.conn, meeting) == ["old transcript"]
    assert _meeting_status(queue.conn, meeting) == "completed"


def test_write_transcript_commits_segments_and_meeting_stamp(queue):
    meeting = queue.meeting(queue.workspace(), "processing")
    rows = [
        (meeting, 0, 0, 1000, "hello", 90),
        (meeting, 1, 1000, 2000, "world", 80),
    ]

    pipeline._write_transcript(queue.conn, meeting, rows, "completed", 2000)

    assert _segment_texts(queue.conn, meeting) == ["hello", "world"]
    assert _meeting_status(queue.conn, meeting) == "completed"
    with queue.conn.cursor() as cur:
        cur.execute("SELECT duration_ms FROM meetings WHERE id = %s", (meeting,))
        assert cur.fetchone()[0] == 2000


def test_process_job_failure_does_not_downgrade_completed_meeting(queue, monkeypatch):
    meeting = queue.meeting(queue.workspace(), "completed")
    job = queue.job(meeting, attempts=1)

    monkeypatch.setattr(pipeline.os.path, "isfile", lambda _path: True)

    def unreadable(_path: str) -> float:
        raise RuntimeError("unreadable audio")

    monkeypatch.setattr(pipeline, "audio_duration_seconds", unreadable)

    with pytest.raises(RuntimeError, match="unreadable audio"):
        pipeline.process_job(queue.conn, job, {"meetingId": meeting})

    assert _meeting_status(queue.conn, meeting) == "completed"
