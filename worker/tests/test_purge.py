import uuid

import pipeline


def _workspace(conn, retention_days: int | None) -> str:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO workspaces (name, retention_days)
            VALUES (%s, %s)
            RETURNING id
            """,
            (f"retention-test-{uuid.uuid4()}", retention_days),
        )
        return cur.fetchone()[0]


def _meeting(
    conn,
    workspace_id: str,
    *,
    age_days: int = 4000,
    status: str = "completed",
) -> str:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO meetings (workspace_id, title, status, created_at)
            VALUES (%s, %s, %s, now() - make_interval(days => %s))
            RETURNING id
            """,
            (workspace_id, "retention test", status, age_days),
        )
        return cur.fetchone()[0]


def _exists(conn, meeting_id: str) -> bool:
    with conn.cursor() as cur:
        cur.execute("SELECT 1 FROM meetings WHERE id = %s", (meeting_id,))
        return cur.fetchone() is not None


def test_null_retention_keeps_old_meetings(conn):
    workspace_id = _workspace(conn, None)
    meeting_id = _meeting(conn, workspace_id)

    pipeline.run_purge(conn)

    assert _exists(conn, meeting_id)


def test_expired_retention_deletes_old_meetings(conn):
    workspace_id = _workspace(conn, 90)
    meeting_id = _meeting(conn, workspace_id, age_days=91)

    pipeline.run_purge(conn)

    assert not _exists(conn, meeting_id)


def test_young_meetings_survive(conn):
    workspace_id = _workspace(conn, 90)
    meeting_id = _meeting(conn, workspace_id, age_days=89)

    pipeline.run_purge(conn)

    assert _exists(conn, meeting_id)


def test_queued_meetings_are_never_purged(conn):
    workspace_id = _workspace(conn, 90)
    meeting_id = _meeting(conn, workspace_id, age_days=4000, status="queued")

    pipeline.run_purge(conn)

    assert _exists(conn, meeting_id)
