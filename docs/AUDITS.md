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
