# TESTING — Kioku

## What is proven (Days 1–3 + pipeline slice, with real runs)

| Check | Command | Proves |
|---|---|---|
| Type safety gate | `pnpm typecheck` (`tsc --noEmit`) | Exit 0 — no TS errors |
| Production build gate | `pnpm build` | Next compiles; `/` static; rest dynamic incl. `/dashboard/meetings/[id]` |
| Schema → migration | `pnpm db:generate` + `pnpm db:migrate` | 9 tables exist via `psql \dt` (auth 4 + workspaces 2 + pipeline 3) |
| **Auth end-to-end** | `bash scripts/smoke-auth.sh` | healthz → providers → CSRF → signed-in email request → **offset-fresh** magic link from console transport → callback cookie → `session` returns `user.id` → dashboard 200 → **DB assertion: owner-membership row for the session's uid in Postgres**. **PASS** on a fresh registration address — provisioning is bound by the gate, not assumed |
| **Pipeline end-to-end** | `bash scripts/smoke-pipeline.sh` (dev server + `cd worker && uv run python pipeline.py` + compose db) | authenticated upload of a real-speech fixture → `jobs` row → worker claim → faster-whisper transcript → `meetings.status=completed` **and** ≥1 `transcript_segments` row asserted in Postgres. **PASS** (meeting `e4823cc2…`: JFK clip → correct text at 81% confidence, `duration_ms=11000` probed exactly) |
| Degenerate filter (negative path) | upload a 1 s sine tone → run worker | 0 speech segments → `low_confidence` (not `completed`, not a fake transcript). **PASS** (tone → `low_confidence`, duration 1 000 ms exact) |
| Lease watchdog | plant a `processing` job with `locked_at = now() - 20 min` → run worker | `requeued 1 stale-lease job(s)` in the log; job re-claimed with `attempts+1`. **PASS** |
| **Full export (differentiator)** | `curl -b jar /api/meetings/<id>/export` → `python3 -m zipfile -t` | valid zip (round-trip-tested), headers `attachment; filename=…zip`; entries: transcript.txt (timestamped, conf%), metadata.json, byte-identical audio (352078 = 352078, CRC clean). **PASS**; negatives 401 (no session) / 404 (cross-workspace id, garbage id) all exercised |
| **Retention purge (differentiator)** | plant workspace `retention_days=0` + completed meeting with real blob + queued sibling → `uv run python pipeline.py --purge-once` | completed meeting + its blob + its queued job deleted; **queued meeting survives** (purge never races an active claim). **PASS** (file deleted at absolute path, leftover jobs 0; first-attempt anomalies were test-setup bugs — blobs in a relative path, and the background worker had claimed the planted job — not sweep bugs) |
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
- **Red → green for money/privacy paths**: metering math, permission checks,
  cost caps, share-token validation must get failing-first tests before/with
  their implementation (T-017 slice).
- The dev log (`/tmp/opencode/kioku-dev.log` by default) is a *capture
  target* for the console magic-link transport: `scripts/smoke-auth.sh`
  greps it. Truncate it (`truncate -s 0`), never `rm`, while a server holds
  the fd — deleting it while an fd is open makes new output invisible.

## Planned test stack (~ Day 7+ slice, T-019)

- App: vitest + (tiny) route/db integration harness against the compose DB.
- Worker: pytest (queue lease/expiry logic first).
- CI after Day 7 compose work; local gates stay `typecheck`, `build`,
  smoke-auth.
