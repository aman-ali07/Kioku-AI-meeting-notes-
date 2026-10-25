"""Worker test fixtures.

Integration tests hit a real Postgres because the queue/purge behavior lives
in SQL. Refuse to run against a non-test database: the purge tests delete
rows, and a typo in DATABASE_URL must never touch the dev database.
"""

import os
import tempfile

import psycopg
import pytest
from psycopg.conninfo import conninfo_to_dict

# pipeline.py reads this at import; no test writes audio files.
os.environ.setdefault("STORAGE_DIR", tempfile.mkdtemp(prefix="kioku-test-audio-"))


@pytest.fixture(scope="session")
def database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        pytest.exit("DATABASE_URL is required for worker tests", returncode=1)

    dbname = conninfo_to_dict(url).get("dbname", "")
    if not dbname.endswith("_test"):
        pytest.exit(
            f"Refusing to run purge tests against {dbname!r}; use a *_test database",
            returncode=1,
        )
    return url


@pytest.fixture()
def conn(database_url: str):
    connection = psycopg.connect(database_url)
    try:
        yield connection
    finally:
        connection.rollback()
        connection.close()
