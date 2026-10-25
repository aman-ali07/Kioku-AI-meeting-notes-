# AUDITS — Kioku

Append-only register of the recurring engineering audit that gates the next
task. Never rewrite an old entry: add a new dated one. Raw lens reports are
summarized here; the evidence commands and the claims they support are named.

## The gate

Four read-only lenses, run before starting the next slice:

1. **Architecture & data** — schema, migrations, state machines, failure modes.
2. **Security & tenancy** — auth, authorization, tenant isolation, input edges.
3. **Quality & verification** — tests that prove behavior, hermeticity, docs.
4. **Product & docs** — claims match reality, known gaps tracked, spec trace.

Rules:

- Findings are ranked **P0** (blocks the next slice), **P1** (fix in this
  slice or explicitly defer with a KI), **P2** (note/track).
- Verdict is **ship**, **ship-with-fixes**, or **stop**. No next slice starts
  without a recorded verdict.
- Audits are read-only. Fixes happen in their own commit and get red→green
  evidence where the defect is testable.
- State what was actually read/run, and what was *not* verified.

## 2026-10-25 — Phase 0 baseline (four lenses)

**Scope:** repository at `28bd1aa` (search slice delivered), full docs and
codebase. Four parallel read-only subagents, one per lens; high-severity
claims spot-checked manually.

**Verdict: ship-with-fixes / at risk.** No auth bypass, IDOR, SQLi, or XSS
found in the current single-user posture. The blockers were assumptions the
next features would inherit:

- **P0 retention:** `retention_days NOT NULL DEFAULT 90` silently deletes
  self-host data; spec promises “forever” on self-host.
- **P0 tenancy/roles:** `getPrimaryWorkspace` used an unordered `LIMIT 1`;
  `viewer` existed in schema but was enforced nowhere.
- **P0 queue:** stale leases ignored `MAX_ATTEMPTS` (crash-loop); failure
  handling was kind-blind; transcript replacement was not atomic.
- **P0 upload:** meeting+job writes and blob cleanup were not atomic.
- **P0 auth edge:** no rate limit / token cleanup on magic-link requests.
- **P0 verification:** no CI; smoke scripts non-hermetic; dev DB carried
  smoke residue.
- **P0 docs/product:** public claims outran delivered features; duplicate
  `KI-8`; no release tag.

**Resolutions so far:** retention (`8be6dae`, T-023), tenancy/roles
(`feb49ef`, T-024), id-validation follow-ups (`7b243ca`, T-025). Queue,
upload, auth-edge, CI, and docs slices remain.

## 2026-10-26 — audit of the tenancy slice (`feb49ef`)

**Scope:** commit `feb49ef` + parent; `workspace.ts`, `workspace-role.ts`,
upload route, tests, and the docs that describe them. Static review plus
targeted read-only probes; suite not re-run by the lens (parent had run it).

**Verdict: ship.** No P0/P1; gate placement (session → tenant → role → body)
and fail-closed behavior verified. P2 follow-ups:

- `getWorkspaceContext(userId, "")` fell back to primary while docs said
  malformed ids return `null`.
- The test-DB guard checked the URL string, not the live connection.
- The export route kept a weaker UUID regex (`36 hyphens` accepted), which
  reached Postgres and returned 500 instead of 404.
- Coverage gaps: viewer read paths unasserted; upload route only exercised
  with `owner` (the `member` case is covered by the pure policy test).

**Resolution:** items 1–3 fixed in `7b243ca` (T-025) with red→green for the
empty-id case and unit coverage for the UUID guard; coverage gaps remain P2.

## 2026-10-26 — audit before the queue slice (P0-4)

**Scope:** `worker/pipeline.py` (claim/requeue/fail/process/main), jobs and
meetings schema, `ARCHITECTURE.md` pipeline section, existing worker tests.
Read-only lens; no DB mutation.

**Verdict: ship-with-fixes.** Confirmed:

- **P1 crash-loop:** `requeue_stale_leases` ignored `MAX_ATTEMPTS`. A poison
  job that hard-crashes the worker is requeued forever; because it is the
  oldest, it starves later jobs and its meeting stays `processing` (and
  therefore exempt from purge).
- **P1 non-atomic transcript replacement:** autocommit connection made
  DELETE → INSERT → UPDATE separate commits; a mid-write failure could
  destroy the previous transcript and leave partial rows.
- **P1 kind/status-blind failure updates:** `fail_job` could mark any meeting
  `failed` from a non-transcribe job, and could downgrade an already
  `completed` transcript after a late retry failure. The job+meeting updates
  were also two separate transactions.
- **P2 retry state:** a retry left the meeting `processing` while the job was
  `queued`; same for requeued stale leases.
- **Future-only P1:** no lease fencing/heartbeat; safe with the documented
  single worker, unsafe once a second worker exists. Defer with a KI.

**Planned slice:** attempts cap in the watchdog, kind/status-scoped meeting
updates in one transaction, retry resets the meeting to `queued`, atomic
transcript replacement, attempts returned from `claim_job`, and pytest
coverage on an autocommit connection. Resolution entry follows the commit.

## 2026-10-26 — resolution of the queue slice (P0-4, T-026)

**Scope:** `worker/pipeline.py`, `worker/tests/test_queue.py`,
`worker/tests/conftest.py`; docs corrected to describe the new semantics.
Implementation review + test runs; no subagent audit was re-run for this
resolve entry (the findings being closed are the ones recorded above).

**Verdict: ship.** Every confirmed finding is closed and pinned by a test:

- Crash-loop (P1) → watchdog enforces the cap: below it, job and meeting
  return to `queued`; at it, both become `failed` with `last_error`
  `lease expired`. Pinned by the terminal-stale and below-cap tests.
- Non-atomic transcript replacement (P1) → `_write_transcript` wraps
  delete/insert/meeting-stamp in one transaction. Pinned by a unique
  violation on the second row: the old transcript and status survive.
- Kind/status-blind failure (P1) → `_set_meeting_status_for_job` is
  transcribe-only and status-guarded; a completed meeting and a non-transcribe
  job each keep their state after a terminal failure. Pinned by two tests.
- Retry state (P2) → retries set the meeting to `queued`. Pinned.
- Two-statement failure update (P2) → one transaction, status-guarded, so a
  late failure cannot resurrect a `done` job. Pinned.
- Claim accounting (P2) → `claim_job` returns the incremented attempt; the
  second read is gone. Pinned.
- Multi-worker fencing (future-only P1) → deferred as **KI-15**; retry
  backoff (confirmed absent) deferred as **KI-16**. Both are documented as
  prerequisites for horizontal scaling, not silently accepted.

**Evidence:** 16 worker tests pass (4 purge + 12 queue); three targeted red
runs failed for the right reasons (transaction removal, cap ignored, guards
removed) before restore; `smoke-pipeline.sh` PASS against a live dev server +
worker; test DB left clean (`jobs=0`, `queue-test-workspaces=0`).

**Next audit:** before the upload-atomicity slice (P0-5) — upload route,
storage adapter, blob/DB failure ordering.

## 2026-10-26 — four-lens audit before the upload slice (P0-5)

**Scope:** repository at `7d7c6f7`; focus on the upload path, storage adapter,
queue/retention interactions, tests, and docs claims. Four parallel read-only
subagents (architecture/data, security/tenancy, quality/verification,
product/docs); no test or DB mutation run by the lenses.

**Verdict: ship-with-fixes.** No auth bypass, cross-tenant attach, path
escape, stored XSS, or committed secret. The upload P0 is the known one.

- **P0 upload atomicity (lens 1+2):** `meetings` and `jobs` are inserted as
  two statements. If `jobs` fails (or the process dies between them), the
  blob is deleted but the committed `queued` meeting remains — no job, dead
  `audio_key`, invisible to purge (queued is exempt), “Queued” forever.
- **P1 pre-buffer limit (lens 2):** `request.formData()` materializes the
  whole multipart body before the 50 MiB check; no reverse-proxy body cap.
  Authenticated memory-DoS. Fix: `Content-Length` precheck + Caddy
  `request_body` cap (verify the pinned Caddy supports it).
- **P1 missing upload tests (lens 3):** only the three role-boundary cases
  exist; no happy path, no jobs-insert failure, no oversize-before-buffering.
  Upload tests must delete `jobs` by `payload->>'meetingId'` before the
  workspace (no FK), or they seed orphan jobs for the global queue tests.
- **P1 test gaps in the queue slice (lens 3):** `finish_job` untested; the
  rollback test's meeting-status assertion is vacuous (`completed`→
  `completed`); `claim_job` persisted attempts untested; `fail_job` retry
  attempts untested; queue fixture does not prove the global queue is clean;
  shared `audio_key` across queue meetings. Worker test-DB guard is URL-only.
  Documented `uv run pytest` misses the `engine-local` extra (`av`).
- **P1 docs truth (lens 4):** README/landing still claim recording,
  summaries, action items, share pages, and a live $6 hosted offer; none
  exist. PRD status tags drifted. Duplicate stale KI-8. Phase 0A header says
  “in progress” with all rows done; P0-5/P0-6/docs/tag have no TASKS row.
- **P2s:** post-write 413 branch leaks the blob (likely unreachable today);
  storage adapter leaves a partial file on stream error; `assertSafeKey`
  checks the literal `\\0` and not path containment; export buffers the whole
  zip; worker image runs as root; no orphan-blob GC; `.env.example` embeds a
  developer absolute path; app test helper leaks `globalThis`/env state.
  Queue semantics themselves are consistent across docs.

**Slice order:** P0-5 upload atomicity + pre-buffer cap + upload/queue test
hygiene first; then P0-6 auth rate limit; then CI (0B); then the docs-truth
pass and `v0.1.0` tag (0C), which owns the README/PRD/KI corrections. Orphan
blob GC is deferred as a KI until the docs slice.

## 2026-10-26 — resolution of the upload slice (P0-5, T-027)

**Scope:** `app/src/app/api/upload/route.ts`, `app/src/storage.ts`,
`app/src/app/api/upload/route.test.ts`, `app/src/storage.test.ts`,
`docker/Caddyfile`, plus the queue test hygiene from lens 3. Read-only lens
reviews above; this entry records fixes + runs only.

**Verdict: ship.** P0 and both P1 upload findings are closed:

- **Atomic meeting+job (P0)** → one Drizzle transaction; injected `jobs`
  trigger failure leaves 0 meetings and 0 files. Ambiguous-commit guard
  re-reads the meeting before deleting audio. Red→green proven by restoring
  two separate inserts (test failed with one meeting).
- **Pre-buffer size gate (P1)** → `Content-Length > 51 MiB` returns 413
  before `formData()`; Caddy `request_body max_size 55MB` validated by
  `caddy validate`. Red→green: removing the precheck returned 400. Parsed
  50 MiB cap remains authoritative; the post-write branch now deletes.
- **Storage integrity (P2 promoted into the slice)** → temp-file + rename
  writes; NUL/backslash/absolute/`..` keys rejected and root-contained.
  Red→green: direct write left a partial file after a stream error.
- **Test hygiene (P1 lens-3)** → upload suite deletes its jobs before the
  workspace (no FK); queue fixture asserts no foreign queued/processing jobs
  (fail loud, not silent contamination); unique audio keys; `finish_job`,
  claim ordering/persisted attempts, malformed payload, and non-vacuous
  rollback assertions added; worker DB guard checks `current_database()`;
  documented worker test command includes `--extra engine-local`.
- **Docs** → D21, ARCHITECTURE, TASKS (T-027), TESTING, CHANGELOG. KI-17
  (orphan-blob GC) and KI-18 (spec §8 preflight) are explicit deferrals.

**Evidence:** 48 app tests (9 files), 20 worker tests (4 purge + 16 queue),
`pnpm typecheck` and production build green; Caddy config valid. Live
`smoke-pipeline.sh` PASS after the change: the job row is asserted
immediately after upload (`queued`), the worker claims it, and the meeting
reaches `completed` with 1 transcript segment.

**Next audit:** before the auth-edge slice (P0-6) — magic-link request path,
token table growth, console transport, JWT lifetime.
