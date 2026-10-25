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
        self.assert_no_foreign_queue()

    def assert_no_foreign_queue(self) -> None:
        """The claim/watchdog queries are global; foreign jobs would make the
        oldest-job assertions silently test someone else's data."""
        with self.conn.cursor() as cur:
            cur.execute(
                """
                SELECT count(*)
                  FROM jobs
                 WHERE payload->>'meetingId' NOT IN (
                       SELECT m.id::text
                         FROM meetings m
                         JOIN workspaces w ON w.id = m.workspace_id
                        WHERE w.name LIKE %s
                       )
                """,
                (f"{self.PREFIX}%",),
            )
            foreign = cur.fetchone()[0]
        assert foreign == 0, (
            f"{foreign} job(s) outside {self.PREFIX}* would contaminate the "
            "global claim/watchdog tests"
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
        audio_key: str | None = None,
    ) -> str:
        if audio_key is None:
            audio_key = f"queue-test/{uuid.uuid4()}.wav"
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
        created_at: datetime | None = None,
    ) -> str:
        if locked_at is None and status == "processing":
            locked_at = datetime.now(timezone.utc)
        with self.conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO jobs
                     (kind, payload, status, attempts, locked_at, created_at)
                VALUES (%s, %s::jsonb, %s, %s, %s, COALESCE(%s, now()))
                RETURNING id
                """,
                (
                    kind,
                    json.dumps({"meetingId": str(meeting_id)}),
                    status,
                    attempts,
                    locked_at,
                    created_at,
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
    state = _job_state(queue.conn, job)
    assert state["status"] == "processing"
    assert state["attempts"] == 2
    assert state["locked_at"] is not None


def test_claim_job_takes_the_oldest_queued_job(queue):
    workspace_id = queue.workspace()
    older = queue.job(
        queue.meeting(workspace_id),
        status="queued",
        attempts=0,
        locked_at=None,
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    newer = queue.job(
        queue.meeting(workspace_id),
        status="queued",
        attempts=0,
        locked_at=None,
        created_at=datetime(2026, 2, 1, tzinfo=timezone.utc),
    )

    claimed = pipeline.claim_job(queue.conn)

    assert claimed is not None
    assert claimed[0] == older
    assert _job_state(queue.conn, newer)["status"] == "queued"


def test_finish_job_settles_a_processing_job(queue):
    meeting = queue.meeting(queue.workspace(), "processing")
    job = queue.job(meeting, attempts=1)

    assert pipeline.finish_job(queue.conn, job) is True

    state = _job_state(queue.conn, job)
    assert state["status"] == "done"
    assert state["locked_at"] is None


def test_finish_job_leaves_a_moved_job_alone(queue):
    meeting = queue.meeting(queue.workspace(), "completed")
    job = queue.job(meeting, status="done", attempts=1, locked_at=None)

    assert pipeline.finish_job(queue.conn, job) is False

    assert _job_state(queue.conn, job)["status"] == "done"
    assert _meeting_status(queue.conn, meeting) == "completed"


def test_fail_job_retry_requeues_and_resets_meeting(queue):
    meeting = queue.meeting(queue.workspace(), "processing")
    job = queue.job(meeting, attempts=1)

    pipeline.fail_job(queue.conn, job, 1, "temporary")

    state = _job_state(queue.conn, job)
    assert state["status"] == "queued"
    assert state["attempts"] == 1
    assert state["locked_at"] is None
    assert state["last_error"] == "temporary"
    assert _meeting_status(queue.conn, meeting) == "queued"


def test_fail_job_terminal_fails_transcribe_meeting(queue):
    meeting = queue.meeting(queue.workspace(), "processing")
    job = queue.job(meeting, attempts=pipeline.MAX_ATTEMPTS)

    pipeline.fail_job(queue.conn, job, pipeline.MAX_ATTEMPTS, "boom")

    state = _job_state(queue.conn, job)
    assert state["status"] == "failed"
    assert state["last_error"] == "boom"
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


def test_fail_job_tolerates_a_malformed_payload(queue):
    meeting = queue.meeting(queue.workspace(), "processing")
    with queue.conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO jobs (kind, payload, status, attempts)
            VALUES ('transcribe', '{"meetingId": "not-a-uuid"}'::jsonb, 'processing', %s)
            RETURNING id
            """,
            (pipeline.MAX_ATTEMPTS,),
        )
        job = cur.fetchone()[0]

    try:
        pipeline.fail_job(queue.conn, job, pipeline.MAX_ATTEMPTS, "bad payload")

        assert _job_state(queue.conn, job)["status"] == "failed"
        assert _meeting_status(queue.conn, meeting) == "processing"
    finally:
        # No meeting row references this job, so the prefix cleanup cannot
        # find it; remove it explicitly or it outlives the test.
        with queue.conn.cursor() as cur:
            cur.execute("DELETE FROM jobs WHERE id = %s", (job,))


def test_write_transcript_rolls_back_a_partial_insert(queue):
    meeting = queue.meeting(queue.workspace(), "processing")
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
    # A leaked UPDATE would have stamped completed + duration 2000.
    assert _meeting_status(queue.conn, meeting) == "processing"
    with queue.conn.cursor() as cur:
        cur.execute("SELECT duration_ms FROM meetings WHERE id = %s", (meeting,))
        assert cur.fetchone()[0] is None


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
