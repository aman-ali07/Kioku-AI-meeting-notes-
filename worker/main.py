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
    checks = {"storage": "not-provisioned (Days 4–6)"}
    ok = True

    url = os.environ.get("DATABASE_URL")
    if not url:
        ok = False
        checks["db"] = "error: DATABASE_URL not set"
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
