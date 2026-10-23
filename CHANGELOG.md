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

### Known gaps → see KNOWN_ISSUES.md (license still pending, plan Day 7).

