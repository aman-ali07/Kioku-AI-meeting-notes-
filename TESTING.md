# TESTING — Kioku

## What is proven (Days 1–3 + pipeline slice, with real runs)

| Check | Command | Proves |
|---|---|---|
| Type safety gate | `pnpm typecheck` (`tsc --noEmit`) | Exit 0 — no TS errors |
| Production build gate | `pnpm build` | Next compiles; `/` static; rest dynamic incl. `/dashboard/meetings/[id]` |
| Schema → migration | `pnpm db:generate` + `pnpm db:migrate` | 9 tables exist via `psql \dt` (auth 4 + workspaces 2 + pipeline 3) |
| **Auth end-to-end** | `bash scripts/smoke-auth.sh` | healthz → providers → CSRF → signed-in email request → **offset-fresh** magic link from console transport → callback cookie → `session` returns `user.id` → dashboard 200 → **DB assertion: owner-membership row for the session's uid in Postgres**. **PASS** on a fresh registration address — provisioning is bound by the gate, not assumed |
| **Pipeline end-to-end** | `bash scripts/smoke-pipeline.sh` (dev server + `cd worker && uv run python pipeline.py` + compose db) | authenticated upload of a real-speech fixture → `jobs` row → worker claim → faster-whisper transcript → `meetings.status=completed` **and** ≥1 `transcript_segments` row asserted in Postgres. **PASS** (meeting `e4823cc2…`: JFK clip → correct text at 81% confidence, `duration_ms=11000` probed exactly) |
| **Search end-to-end (Days 8–10)** | `bash scripts/smoke-search.sh` (dev server + compose db) | Seeds one meeting in the caller's tenant + one in a foreign tenant via psql → title hit grouped to **one row despite two matching segments**, transcript hit with highlighted snippet and segment timestamp, **foreign phrase returns 0 rows**; dashboard renders the hit and `?seg=0` deep link loads; 401 / empty / 1-char / 201-char boundaries. **PASS** (seeded rows cleaned up by the script); `EXPLAIN` shows Bitmap Index Scan on `transcript_segments_search_idx`, `meetings_search_idx`, `meetings_title_trgm_idx` |
| Degenerate filter (negative path) | upload a 1 s sine tone → run worker | 0 speech segments → `low_confidence` (not `completed`, not a fake transcript). **PASS** (tone → `low_confidence`, duration 1 000 ms exact) |
| Lease watchdog | plant a `processing` job with `locked_at = now() - 20 min` → run worker | `requeued 1 stale-lease job(s)` in the log; job re-claimed with `attempts+1`. **PASS** |
| **Full export (differentiator)** | `curl -b jar /api/meetings/<id>/export` → `python3 -m zipfile -t` | valid zip (round-trip-tested), headers `attachment; filename=…zip`; entries: transcript.txt (timestamped, conf%), metadata.json, byte-identical audio (352078 = 352078, CRC clean). **PASS**; negatives 401 (no session) / 404 (cross-workspace id, garbage id) all exercised |
| **Retention purge (differentiator)** | plant workspace `retention_days=0` + completed meeting with real blob + queued sibling → `uv run python pipeline.py --purge-once` | completed meeting + its blob + its queued job deleted; **queued meeting survives** (purge never races an active claim). **PASS** (file deleted at absolute path, leftover jobs 0; first-attempt anomalies were test-setup bugs — blobs in a relative path, and the background worker had claimed the planted job — not sweep bugs) |
| **Retention semantics (Phase 0A)** | `TEST_DATABASE_URL=…_test pnpm test` + `cd worker && DATABASE_URL=…_test uv run --extra engine-local pytest -q` | Schema allows `NULL` (never purge) and positive days; provisioning leaves `NULL` when `DEFAULT_RETENTION_DAYS` is unset, applies 90 when set, and fails closed on malformed values; purge keeps NULL-retention and queued meetings, deletes 91-day-old, keeps 89-day-old. **PASS**: 15 vitest + 4 pytest; red→green shown by temporarily restoring the old `NOT NULL` constraint in `kioku_test` (provisioning + NULL-purge tests failed, then passed after `0005`) |
| **Tenant resolution + role gate (Phase 0A)** | `TEST_DATABASE_URL=…_test pnpm test` (workspace resolution, upload route boundary) + a live session downgraded to viewer | Explicit workspace ids resolve only through the caller's membership (foreign/malformed → null); no id picks the oldest membership with a workspace-id tie-break; viewer upload is 403 **before** the body is read, owner passes to normal validation. **PASS**: 26 vitest (6 files); red→green by reversing `orderBy` (oldest-membership test failed) and allowing all roles (viewer unit + route tests failed); live: viewer 403 `Read-only workspace`, owner 400 `Expected multipart/form-data` |
| **ID validation follow-ups (Phase 0A)** | `TEST_DATABASE_URL=…_test pnpm test` | Empty workspace id is malformed (null), not a primary-workspace fallback; the shared canonical UUID validator rejects the 36-hyphen form the export route used to accept (which caused a 500); the DB test bootstrap verifies `current_database()` ends in `_test`, not just the URL. **PASS**: 37 vitest (8 files); empty-string case red→green |
| **Queue state machine + transcript atomicity (Phase 0A)** | `cd worker && DATABASE_URL=…_test uv run --extra engine-local pytest -q` (16 queue tests on an autocommit connection) + `bash scripts/smoke-pipeline.sh` | Stale lease below the cap requeues job+meeting; at `MAX_ATTEMPTS` both fail terminally (no crash-loop); a fresh lease is untouched; `claim_job` returns and persists the incremented attempt and takes the oldest queued job; `finish_job` settles only a `processing` job; `fail_job` retry resets the meeting to `queued` and keeps attempts; terminal failure fails a transcribe meeting but **not** a completed one and **not** a non-transcribe job; a malformed payload settles without raising; a late failure cannot resurrect a `done` job; a mid-write unique violation rolls back to the previous transcript, status, and duration. **PASS**: 20 pytest total (4 purge + 16 queue); red→green by removing `conn.transaction()` (rollback test failed), ignoring the attempts cap (terminal-stale test failed), and dropping kind/status guards (two meeting-state tests failed); live pipeline smoke PASS (upload → terminal `completed`, job asserted, 1 segment row); test DB clean after (`jobs=0`) |
| **Atomic upload + storage (Phase 0A)** | `TEST_DATABASE_URL=…_test pnpm test` (upload route, storage adapter) | Happy path commits meeting (`queued`, owning workspace, server key) **with** its transcribe job and a 4-byte blob on disk; an injected `jobs` insert failure (Postgres trigger) rolls the meeting back and removes the blob; a declared `Content-Length` over the cap returns 413 **before** multipart parsing and writes nothing; unsafe storage keys (empty, `..`, absolute, backslash, NUL) are refused; a stream error leaves neither the destination nor a temp file; Caddy `request_body` config validates. **PASS**: 48 vitest (9 files); red→green: two separate inserts left a meeting after the injected failure, removing the header precheck returned 400, direct-write storage left a partial file; live `smoke-pipeline.sh` PASS (job row `queued` right after upload → terminal `completed`, 1 segment) |
| **Worker survives db outage** | `docker compose -f docker-compose.yml restart db` against a live worker | loop logs `db connection lost, reconnecting (AdminShutdown)`, process stays ALIVE, resumes claiming; connection-at-startup retries with backoff too (connect is never fatal for the supervised loop). **PASS** — after the bounce a fresh `smoke-pipeline.sh` run green |
| **Self-host compose end-to-end** | `docker compose -f docker-compose.selfhost.yml up -d --build` + `bash scripts/smoke-selfhost.sh http://localhost:8080` | Caddy→web (standalone image) → magic link from container logs → upload through the stack → containerized worker (small/int8, model into `model-cache` volume) → `completed` → export zip valid. **PASS** (meeting `ff6bd9ab…`); migrate one-shot applied all 9 tables on the fresh selfhost db (78 ms) |
| Upload boundary guards | curl without cookie / `.txt` payload / >50 MiB body | 401 / 400 unsupported-type / 413 too-large. **PASS** (all three) |
| Tenant provisioning | psql join query | `Personal` workspace row, `billing_plan=free`, owner membership tied to the session's user id |
| Worker health (positive) | `uv run uvicorn main:app --port 8009` + curl | `200 {db:"ok", storage:"ok"}` |
| Worker health (negative) | same with unreachable `DATABASE_URL`/bad STORAGE_DIR | `503` with `error` checks (detail only in server logs — non-sensitive response) |

## Rules

- **Smoke before claims**: any change to auth, provisioning, upload, or
  health/queue paths re-runs the matching gate (`scripts/smoke-auth.sh`,
  `scripts/smoke-pipeline.sh`) and the worker checks before "done". The
  scripts assert Postgres rows themselves — a dashboard 200 alone (or a
  `completed` status without a segments-count check) is NOT proof.
- **Build env prerequisite (honest one)**: `pnpm build` imports the db client
  at module scope, so DATABASE_URL must exist in the build environment
  (in CI you may set a placeholder; the real connection happens on first
  query). This is documented in `app/src/db/client.ts` — don't re-abstract
  around DrizzleAdapter's eager introspection; it breaks adapters.
- **No tautological tests** — assert on behavior/DB rows/HTTP responses, not
  on mocks constructed inside the test.
- **Shared smoke login** — `scripts/lib/smoke-session.sh` holds the one
  magic-link chain used by `smoke-auth.sh`, `smoke-pipeline.sh`, and
  `smoke-search.sh`; fix the helper once, not three copies.
- **Red → green for money/privacy paths**: metering math, permission checks,
  cost caps, share-token validation must get failing-first tests before/with
  their implementation (T-017 slice).
- The dev log (`/tmp/opencode/kioku-dev.log` by default) is a *capture
  target* for the console magic-link transport: `scripts/smoke-auth.sh`
  greps it. Truncate it (`truncate -s 0`), never `rm`, while a server holds
  the fd — deleting it while an fd is open makes new output invisible.

## Test stack (started 2026-10-25, T-019)

- **App:** `pnpm test` (vitest). Unit tests for pure helpers, plus a
  provisioning integration test that requires `TEST_DATABASE_URL` pointing at
  a database whose name ends in `_test` (the test refuses anything else).
- **Worker:** `cd worker && DATABASE_URL=postgres://…/kioku_test uv run --extra engine-local pytest -q`.
  The `engine-local` extra is required because `pipeline.py` imports `av` and
  `faster_whisper` at module load; a bare `uv run pytest` only works if the
  venv happens to have the extra installed.
  The fixture also refuses a non-`_test` database.
- **Create/migrate the test DB once:**
  ```sh
  docker compose exec -T db psql -U kioku -d kioku -c "CREATE DATABASE kioku_test"
  cd app && DATABASE_URL=postgres://kioku:kioku@localhost:5433/kioku_test pnpm db:migrate
  ```
- **CI:** not wired yet — next Phase 0B slice (GitHub Actions + Postgres 16
  service). Local gates remain `typecheck`, `build`, `test`, worker `pytest`,
  and the smoke scripts.
