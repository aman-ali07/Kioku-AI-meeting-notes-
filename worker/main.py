"""Kioku worker — FastAPI service.

Day-3 scaffold: /healthz with a real database check. The transcription
pipeline (queue pop, lease semantics, faster-whisper / Groq engines) lands
with the Days 4–6 milestone; storage and engine checks activate then.
"""
import os

import psycopg
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.responses import JSONResponse

load_dotenv()  # reads worker/.env; real process env always wins

app = FastAPI(title="kioku-worker")


@app.get("/healthz")
def healthz():
    checks = {}
    ok = True

    # Storage: STORAGE_DIR must exist and be writable (the worker only reads
    # here, but a read-only mount would break nothing today and should not
    # pass silently either — the app writes the files this process consumes).
    storage_dir = os.environ.get("STORAGE_DIR")
    if storage_dir and os.path.isdir(storage_dir) and os.access(storage_dir, os.W_OK):
        checks["storage"] = "ok"
    else:
        ok = False
        checks["storage"] = "error"
        print(
            f"[healthz] STORAGE_DIR not usable: {storage_dir!r} (missing or read-only)",
            flush=True,
        )

    url = os.environ.get("DATABASE_URL")
    if not url:
        ok = False
        # Keep the response non-sensitive (mirror the app-side healthz): detail
        # goes to this process's logs only.
        checks["db"] = "error"
        print("[healthz] DATABASE_URL is not set", flush=True)
    else:
        try:
            with psycopg.connect(url, connect_timeout=3) as conn:
                conn.execute("SELECT 1")
            checks["db"] = "ok"
        except psycopg.Error as exc:
            ok = False
            checks["db"] = "error"
            # Full detail stays in this process's logs; the HTTP response
            # stays non-sensitive.
            print(f"[healthz] db check failed: {exc}", flush=True)

    return JSONResponse(
        {"service": "kioku-worker", "status": "ok" if ok else "degraded", "checks": checks},
        status_code=200 if ok else 503,
    )
