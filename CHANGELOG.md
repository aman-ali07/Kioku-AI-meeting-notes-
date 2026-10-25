# CHANGELOG

All notable verified changes to Kioku. Format: Keep a Changelog; dates are
real session dates. No invented release history — this repo has no published
releases yet.

## [Unreleased — Days 1–3 milestone] — 2026-10-22

### Added
- Approved design spec copied into the repo: `docs/specs/2026-10-22-kioku-design.md`.
- pnpm monorepo root: workspace config, compose dev db (postgres:16-alpine on
  host :5433), per-package env contracts (`app/.env.example`,
  `worker/.env.example`), README, agent documentation set (AGENTS.md, PRD,
  ARCHITECTURE, TASKS, TECH_STACK, DATABASE, SECURITY, TESTING, DEPLOYMENT,
  docs/DECISIONS, KNOWN_ISSUES, CHANGELOG).
- `app/` — Next.js 15.5.9 + TypeScript + Tailwind 4: landing, `/login`
  (email magic link + env-gated Google button), `/dashboard` (tenant join),
  `/healthz` (truthful checks; 503 on db error), Auth.js v4 via
  `src/pages/api/auth/[...nextauth].ts`, Drizzle schema (adapter tables +
  workspaces + workspace_members), forward-only migration `0000` applied,
  workspace auto-provisioning on first sign-in (fail-closed).
- `worker/` — FastAPI scaffold with `/healthz` (db check; verified 200 and
  503 paths), uv-managed deps.
- `scripts/smoke-auth.sh` — one-command register+login DoD gate.

### Verified (registration-grade evidence in TESTING.md)
- `pnpm build` green; `pnpm typecheck` exit 0.
- Auth smoke PASS (fresh email; session `user.id` matches tenant row).
- Migrations: 6 tables confirmed in psql.
- Both `/healthz` endpoints truthfully reflect DB state.

### Fixed — 2026-10-23 (audit-driven hardening, T-019b)

- Provisioning race closed: per-user transaction-scoped advisory lock +
  re-check inside the transaction (two concurrent first sign-ins can no
  longer mint two "Personal" workspaces — matters once meters are
  per-workspace).
- Smoke gate now proves provisioning in the database (owner-membership row
  for the session uid), captures only *new* log bytes (stale-link failure
  mode removed), and fails loudly on any non-2xx (`curl -f`).
- `migrate.ts` no longer masks non-ENOENT fs failures as "no .env found".
- Dashboard treats a malformed session (missing uid) as signed-out instead
  of querying a tenant with an empty id; `user.id` typing made honest
  (optional in augmentation).
- Google env gate deduped through `isGoogleAuthConfigured()`;
  `billing_plan` TS union widened to `free|pro|team|selfhost` (no DB change
  — text column, constraint deliberately deferred until billing stabilizes).
- Worker `/healthz` error strings made non-sensitive; `.env` files
  chmod 600. Build prerequisite (DATABASE_URL present at build time)
  documented honestly after the lazy-DB attempt broke DrizzleAdapter's
  eager introspection.

### Added — Days 4–6 pipeline slice (2026-10-23/24)

- Pipeline schema: `meetings`, `transcript_segments`, `jobs` (migrations
  `0001` + `0002` — the second one is the fix-forward correcting my own
  unique→plain index mistake before it could bite).
- `app/src/storage.ts` — filesystem storage adapter (3 ops: put/get/delete)
  on `STORAGE_DIR`; S3/R2 driver swaps in behind the same signatures later.
- `POST /api/upload` — session + tenant guarded, type/size boundary-checked,
  server-generated storage keys, ground-truth disk size recheck, orphan-file
  cleanup on DB failure. Boundaries verified: 401/400/413.
- `worker/pipeline.py` — claim loop (`FOR UPDATE SKIP LOCKED`), 15-min lease
  watchdog, PyAV duration probe, faster-whisper small/int8 CPU transcription,
  degenerate-output filter (post-ASR, pre-summary), retry-until-3-attempts
  semantics with `failed` visible on the meeting.
- Engine pin recorded in TECH_STACK after PyPI verification:
  faster-whisper **1.2.1** (MIT, SYSTRAN) + **av 14.2.0** (PyAV 15+ is a
  breaking line for it); worker venv pinned to Python 3.12 via
  `.python-version` for wheel availability.
- Dashboard: tenant-scoped meetings list, upload form,
  `/dashboard/meetings/<id>` transcript view (cross-tenant ids 404).
- `scripts/smoke-pipeline.sh` — upload → queue → transcribe → rows gate;
  **PASS** (JFK speech clip → completed, correct text).
- Worker `/healthz` storage check made real (STORAGE_DIR exist+writable).

### Added — differentiator slice: retention purge + full export (2026-10-23/24)

- **Auto retention-purge** in the worker loop (hourly sweep over
  `workspaces.retention_days`; queued/processing meetings exempt; dockets:
  audio blob + meeting row + queued jobs; `--purge-once` for ops/cron).
  Verified: deleted matching blob + rows at `retention_days=0` while the
  queued sibling survived.
- **One-click full export** `GET /api/meetings/<id>/export` —
  transcript.txt + metadata.json + original audio in a zip, session- and
  tenant-guarded (cross-workspace → 404, no existence leak). Zip builder is
  dependency-free (store-only, `zlib.crc32`) and round-trip-tested.
- Transcript page surfaces the purge date and the export button.
- App `/healthz` storage check made real (STORAGE_DIR exist + writable) —
  both services now report the same truthful `{db, storage}` contract.
- TECH_STACK: none added — the export path deliberately carries no new
  dependency.

### Added — Day 7 slice A: licensing paperwork (2026-10-24)

- `LICENSE` — verbatim AGPL-3.0 (byte-compared against two independent
  downloads from gnu.org; canonical sha256 prefix `0d96a4ff…`).
- `TRADEMARKS.md` — the name/logo are not part of the license grant
  (AGPL §7e): referential use fine, passing off not.
- License metadata: `app/package.json` `"license":
  "AGPL-3.0-or-later"`, `worker/pyproject.toml` PEP 621 license table.

### Added — Day 7 slice B: self-host stack (2026-10-24)

- `docker-compose.selfhost.yml` v0 — web + worker + db + shared audio volume
  + Caddy, under its own project name (`kioku-selfhost`) so dev and self-host
  composes can never collide (proven the hard way: without it the selfhost db
  replaced the dev container AND mounted the dev volume — today's lesson).
- `docker/web.Dockerfile` — standalone Next build (deps/build/toolchain/run
  targets; toolchain runs the one-shot `migrate` service). Tracing root pinned
  to the pnpm workspace root — pinning to `app/` silently ships a bundle
  WITHOUT `next` (second lesson). Storage dir seeded as `node` before the
  USER switch so a fresh volume is writable by the app (third lesson).
- `docker/worker.Dockerfile` — engine-local wheels baked (no BuildKit features
  — the box may not have buildx); model cache volume persists upgrades.
- `docker/Caddyfile` + `deploy/selfhost.env.example` — site by `SITE` env:
  public host = auto-TLS, `http://…` = plain HTTP for LAN/test.
- `scripts/smoke-selfhost.sh` — the Day-7 gate: **PASS** (proxy → magic link
  from container logs → upload → containerized worker transcribes → export
  zip valid). Migrate-from-zero on the fresh selfhost db: 78 ms.
- `.dockerignore` — secrets/rule #1: `**/.env` and `data/` never enter a
  build context.
- `next.config.mjs` — `output: "standalone"` (as its comment promised).

### Fixed — Day 7 slice B: worker resilience

- `pipeline.py` loop outlives the connection: per-tick reconnect on
  `psycopg.Error`, connection retries with 1–30 s backoff. Exposed when the
  dev db was restarted under a live worker (`AdminShutdown` used to kill the
  loop); live-proven: bounce db → "db connection lost, reconnecting" →
  process alive → fresh smoke-pipeline PASS.

### Added — Days 8–10 slice A: search (2026-10-25)

- **Meeting search** (T-022): `GET /api/search?q=` + `/dashboard?q=` search
  meeting titles and transcript text. Generated `tsvector` columns with GIN
  indexes, `pg_trgm` title index, `websearch_to_tsquery` (English v1),
  results grouped per meeting with `ts_headline` snippets rendered as safe
  React `<mark>` parts, and segment deep links (`?seg=<idx>`).
- Migrations `0003` (custom: `pg_trgm`) and `0004` (generated columns +
  indexes), applied and psql-verified.
- `scripts/smoke-search.sh` — new gate (title/transcript hits, grouping,
  cross-tenant 0 rows, dashboard render + deep link, 401/empty/short/
  oversized boundaries). **PASS**.
- `scripts/lib/smoke-session.sh` — shared magic-link flow; `smoke-auth.sh`
  and `smoke-pipeline.sh` refactored onto it and re-run: both **PASS**.
- Verified: `pnpm typecheck` exit 0, `pnpm build` green, `EXPLAIN` uses
  `transcript_segments_search_idx`, `meetings_search_idx`, and
  `meetings_title_trgm_idx`.

### Fixed — Phase 0A: retention forever on self-host (2026-10-25)

- **Data-loss fix (T-023):** `workspaces.retention_days` is now nullable;
  `NULL` means keep forever. Migration `0005` drops the old
  `NOT NULL DEFAULT 90`. New workspaces get `DEFAULT_RETENTION_DAYS` at
  provisioning: unset/empty = forever (self-host default), `90` = cloud-free.
  The worker purge filters `retention_days IS NOT NULL`; dashboard and meeting
  pages render “Forever”/“Kept indefinitely” instead of `null days`.
- **Test harness started:** `vitest` + `pytest`; `pnpm test` covers retention
  formatting, env parsing, and provisioning against a `*_test` Postgres;
  worker tests cover NULL/expired/young/queued purge behavior. CI is next.
- Existing self-host workspaces keep their stored 90 until deliberately
  changed; upgrade note added to DEPLOYMENT.md.

### Fixed — Phase 0A: deterministic tenancy + viewer write gate (2026-10-25)

- **T-024:** `getWorkspaceContext(userId, workspaceId?)` replaces the
  unordered `LIMIT 1` tenant lookup. No id → oldest membership
  (`created_at`, then `workspace_id`); an explicit id must be canonical UUID
  **and** belong to the caller, otherwise `null` (fail closed). The old
  `getPrimaryWorkspace` remains the v1 call-site name.
- **Roles are enforced:** `canWriteToWorkspace` (pure policy: owner/member
  write, viewer read-only) now guards `POST /api/upload` before the body is
  read; viewers get `403 Read-only workspace` but keep dashboard/search/export.
- Tests: shared `test-support/database.ts` bootstrap (refuses non-`_test`
  databases) used by provisioning, workspace resolution, and route-boundary
  suites — 26 app tests total. Red→green shown for both the ordering contract
  and the viewer gate; a live magic-link session was downgraded to viewer
  (403) and restored to owner (passed the gate) against the dev server.
- Docs: D19, SECURITY, ARCHITECTURE, TASKS (T-024), KNOWN_ISSUES (KI-14).

### Fixed — Phase 0A: id-validation audit follow-ups (2026-10-26)

- **T-025:** shared strict `isUuid` (`app/src/lib/uuid.ts`) replaces two
  divergent validators. The export route's old regex accepted 36 hyphens,
  which reached Postgres as an invalid uuid and returned 500; it now returns
  404 before the query. `getWorkspaceContext(userId, "")` now follows the
  documented malformed-id contract (`null`) instead of silently resolving the
  primary workspace.
- Test-DB guard now asks the live connection `current_database()` as well as
  checking the URL suffix, closing the static-import hole where
  `DATABASE_URL` could already point at a non-test database.
- Evidence: `pnpm test` 37 passed (8 files); empty-string case seen red then
  green; typecheck + production build green.

### Fixed — Phase 0A: queue state machine + atomic transcripts (2026-10-26)

- **T-026:** the stale-lease watchdog now enforces `MAX_ATTEMPTS`. A job that
  hard-crashes the worker is no longer requeued forever (crash-loop that
  starved later jobs); below the cap job + meeting return to `queued`, at the
  cap both fail terminally.
- `fail_job` moves job and meeting in **one transaction**, only for
  `transcribe` jobs, and only while the meeting is in flight — a late retry
  failure can no longer overwrite a completed transcript or fail a meeting
  from an unrelated job kind. Retries reset the meeting to `queued`.
- Transcript replacement (delete + insert + meeting stamp) is one
  transaction: a mid-write failure leaves the previous transcript and status
  untouched instead of a half-deleted set.
- `claim_job` returns the incremented attempt (no second read); `finish_job`
  only settles a still-`processing` job.
- Tests: `worker/tests/test_queue.py` (12 cases on an autocommit,
  production-shaped connection) — 16 worker tests total. Red→green: removing
  the transaction failed the rollback test, ignoring the cap failed the
  terminal-stale test, dropping the kind/status guards failed two
  meeting-state tests. Live `smoke-pipeline.sh` PASS (upload → `processing` →
  `completed`, 1 segment row).
- Docs: D20, ARCHITECTURE pipeline section, DATABASE, TASKS (T-026),
  TESTING, KNOWN_ISSUES (KI-15 lease fencing, KI-16 retry backoff).

### Fixed — Phase 0A: atomic upload + pre-buffer size gate (2026-10-26)

- **T-027:** `meetings` and `jobs` are now inserted in one transaction. A
  failed job insert rolls the meeting back and deletes the blob, so a
  `queued` meeting can no longer exist without a job (previously stuck at
  “Queued” forever, exempt from purge). If the transaction throws but the
  rows committed, the route re-checks the meeting row and keeps the audio.
- Oversized declared bodies (`Content-Length` > 51 MiB) are rejected before
  `request.formData()` buffers them; Caddy adds `request_body max_size 55MB`
  for chunked uploads. The parsed 50 MiB file cap stays authoritative, and
  the post-write over-limit branch now deletes its blob.
- Storage adapter: writes stage to a temp file and rename on success (no
  partial object after a failed stream); keys reject empty/NUL/backslash/
  absolute/`..` forms and are contained under `STORAGE_DIR`.
- Tests: upload happy path (meeting + job + blob), injected jobs-insert
  failure via a Postgres trigger, declared-oversize precheck, storage
  round-trip/guards/stream-error; upload tests clean their jobs so the
  global queue tests cannot claim leftovers; 20 worker tests (finish_job,
  claim ordering, malformed payload, non-vacuous rollback assertions) and
  48 app tests. Red→green for the transaction, precheck, and atomic write.
  Live `smoke-pipeline.sh` PASS: a job row exists right after upload, the
  worker claims it, and the meeting reaches `completed` with 1 segment.
- Docs: D21, ARCHITECTURE upload section, TASKS (T-027), TESTING,
  KNOWN_ISSUES (KI-17 orphan-blob GC, KI-18 spec §8 preflight).

### Known gaps → see KNOWN_ISSUES.md (search is English/whole-word v1; no pagination).

