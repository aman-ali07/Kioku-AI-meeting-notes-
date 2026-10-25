# TASKS — Kioku

Statuses: **done** (verified, evidence noted) · **in-progress** · **blocked**
(needs something outside the repo) · **planned** (spec'd in
`docs/specs/2026-10-22-kioku-design.md`, no real implementation yet).
Update this file whenever planning or implementation status changes.

## Delivered (Days 1–3 slice, 2026-10-22)

| ID | Task | Status | Acceptance / evidence |
|---|---|---|---|
| T-001 | Copy approved spec into repo | done | `docs/specs/2026-10-22-kioku-design.md` (280 lines, import from `/home/aman/.opencode/plan/steno-plan.md`) |
| T-002 | pnpm monorepo + root foundation | done | `pnpm-workspace.yaml`, root scripts, compose (postgres:16-alpine), `.gitignore` (secrets excluded); commit `bc4a4f4` |
| T-003 | Next.js 15 app scaffold | done | routes `/`, `/login`, `/dashboard`, `/healthz`; `pnpm build` green (static /, dynamic the rest) |
| T-004 | Drizzle schema + first migration | done | 6 tables verified in psql (`user`, `account`, `session`, `verificationToken`, `workspaces`, `workspace_members`); `app/drizzle/0000_*.sql` applied |
| T-005 | Auth: magic link + env-gated Google + JWT + first-workspace provisioning | done | `scripts/smoke-auth.sh` PASS (fresh email; session returned `user.id`; psql row `Personal / free / owner` matching session id) |
| T-006 | Truthful `/healthz` (app + worker) | done | app 200 `{db: ok}`; worker 200 ok-path and verified 503 error-path (db unreachable) |
| T-007 | Worker scaffold (FastAPI, uv) | done | `uv sync`; `/healthz` verified on :8009 (incl. bad-DB 503 run) |
| T-008 | Auth smoke script committed | done | `scripts/smoke-auth.sh`, executable, PASS run recorded |
| T-009 | Documentation set (this file set) | done | AGENTS/PRD/ARCHITECTURE/… composed from verified repo state; no invented features |

### Hardening slice — audit follow-ups (2026-10-23)

| ID | Task | Status | Acceptance / evidence |
|---|---|---|---|
| T-019b | Close the audit findings before Days 4–6 | done | `pg_advisory_xact_lock` + in-tx recheck in provisioning (race → two "Personal" workspaces would corrupt per-workspace metering); smoke gate binds Postgres rows (owner membership for the session uid) + fresh-link offset capture + `curl -f` everywhere; migrate.ts ENOENT-only catch; dashboard guards malformed session ids; dedup'd Google env gate; `.env` files chmod 600; worker healthz non-sensitive error string. Evidence: typecheck exit 0, `pnpm build` green, smoke PASS (fresh email, uid `9226…`, tenant row verified by the script) |

### Days 4–6 pipeline slice (delivered 2026-10-24)

| ID | Task | Status | Acceptance / evidence |
|---|---|---|---|
| T-013 | Audio upload + storage layer | done | fs adapter (`app/src/storage.ts`, 3 ops — S3/R2 swap-in later); `POST /api/upload` (session + tenant guards, type allowlist, ≤50 MiB, disk-size ground truth, orphan cleanup); migrations `0001`+`0002` (meetings/transcript_segments/jobs; unique→plain index fix-forward). Evidence: typecheck + build green; e2e curl upload → file on disk + rows verified; 401/400/413 boundaries all exercised |
| T-014 | `jobs` queue with SKIP LOCKED + lease | done | claim loop `UPDATE … WHERE id=(SELECT … FOR UPDATE SKIP LOCKED LIMIT 1 RETURNING …)`; 15-min watchdog requeues stale leases (verified by planting a stale job); MAX_ATTEMPTS=3 → `failed` + meeting `failed`. No LISTEN/NOTIFY yet — deliberate (self-host simple; audit-cheap) |
| T-015 | Local engine runner + degenerate filter | done | faster-whisper **1.2.1** (PyPI-verified MIT, owner SYSTRAN) pinned in `engine-local` extra with `av==14.2.0` (PyAV ≥15 removed a kwarg faster-whisper still passes; worker pinned to Python 3.12 accordingly); small/int8 CPU, PyAV duration probe; degenerate filter (mean conf < 0.5, >8× exact-line repeat, mostly-empty → `low_confidence`, post-ASR pre-summary). Evidence: sequential positive+negative runs — JFK clip → `completed` with correct text (81% conf), sine tone (0 segments) → `low_confidence`; `duration_ms` probed exactly (11 000 / 1 000) |
| T-016a | Dashboard meetings list + transcript page | done | tenant-scoped list + `/dashboard/meetings/<id>` (foreign-workspace id → 404); upload form (client) → API. Evidence: typecheck/build green; renders behind working queries |
| T-016-not-yet | Summaries + action items + share pages | planned | Days 11–13 milestone (T-016 in the table below) — this slice only delivered the transcript plumbing it lists as its prerequisite; dashboard list is T-016a, search is T-022 |

### Differentiator slice — retention purge + 1-click export (delivered 2026-10-24)

| ID | Task | Status | Acceptance / evidence |
|---|---|---|---|
| T-020 | Auto retention-purge (worker loop) | done | hourly sweep in `pipeline.py` over workspace `retention_days`; blob+rows+queued jobs removed; queued/processing exempt (never races a claim); `--purge-once` for ops. Evidence: planted `retention_days=0` tenant — completed meeting/blob/queued job deleted, queued sibling survived (TESTING.md table row) |
| T-021 | 1-click full export | done | `GET /api/meetings/<id>/export`: transcript+metadata+audio zip, tenant-guarded, dependency-free store-zip (round-trip proved). Evidence: curl → valid zip, byte-identical audio, 401/404 negatives pass |
| T-011 | LICENSE + TRADEMARKS + README v0 | done | LICENSE = verbatim AGPL-3.0 (byte-compared vs two gnu.org downloads, `0d96a4ff…`); TRADEMARKS.md (name/logo outside the §7e license grant); license metadata in both package manifests; README gains the self-host quickstart |
| T-012 | Self-host compose (web + worker + db + storage + Caddy) | done | `docker-compose.selfhost.yml` v0 — standalone web image + engine-local worker image + migrate one-shot + supervised worker; **plus** `scripts/smoke-selfhost.sh` full-stack gate (proxy→auth→upload→transcribe→export). Storage = shared fs volume per D15 (S3 swap is a storage-adapter swap). Evidence: TESTING.md rows (container e2e PASS; migrate from-zero on fresh db 78 ms); worker outage-resilience fix committed alongside |

### Days 8–10 slice A — search (delivered 2026-10-25)

| ID | Task | Status | Acceptance / evidence |
|---|---|---|---|
| T-022 | FTS + trigram meeting search | done | Generated `tsvector` columns on `meetings.title` + `transcript_segments.text` with GIN indexes; `pg_trgm` title index (migrations `0003` extension + `0004` columns/indexes, applied and psql-verified); tenant-scoped `GET /api/search?q=` and `/dashboard?q=` with results grouped per meeting, highlighted snippets, and segment deep links. Evidence: `scripts/smoke-search.sh` PASS (title + transcript hits, one row despite two segment matches, **cross-tenant 0 rows**, 401/empty/1-char/201-char boundaries, dashboard render + `?seg=0` link); `EXPLAIN` shows Bitmap Index Scan on all three indexes; typecheck + build green |

### Phase 0A — trust gate (in progress, 2026-10-25)

| ID | Task | Status | Acceptance / evidence |
|---|---|---|---|
| T-023 | Retention `NULL = forever` + self-host default | done | Migration `0005` drops `NOT NULL DEFAULT 90`; `DEFAULT_RETENTION_DAYS` unset/empty at provisioning = `NULL` (self-host), `90` = cloud-free; purge query filters `retention_days IS NOT NULL`; dashboard/meeting page render “Forever”/“Kept indefinitely”. Evidence: `pnpm test` 15 passed (incl. provisioning integration against `kioku_test`: NULL when unset, 90 when set, malformed value fails closed); `cd worker && DATABASE_URL=…_test uv run pytest` 4 passed (NULL keeps old meeting, 90 purges 91-day-old, young survives, queued exempt); red→green proven by temporarily restoring `NOT NULL` in the test DB (provisioning + NULL-purge tests failed, then passed after `0005`); typecheck green; `0005` applied and `\d workspaces` shows nullable/no default |
| T-024 | Deterministic workspace resolution + viewer write gate | done | `getWorkspaceContext(userId, workspaceId?)` resolves through `workspace_members` only: explicit id must be a canonical UUID **and** a membership (foreign/malformed → `null`); no id → oldest `created_at`, tie-broken by `workspace_id` (replaces unordered `LIMIT 1`). `canWriteToWorkspace` (owner/member write; viewer read-only) enforced by `POST /api/upload` before the body is read (403 `Read-only workspace`). Evidence: `pnpm test` 26 passed (6 files) — 6 resolution tests + 3 route-boundary tests (401, viewer 403, owner reaches validation); red→green by (a) reversing the `orderBy` → oldest-membership test failed, (b) making the policy allow-all → viewer unit + route tests failed, both restored green. Live: real magic-link session downgraded to `viewer` → upload 403; restored `owner` → upload passes the gate to 400 validation. `pnpm typecheck` and `pnpm build` green |

## Blocked

| ID | Task | Blocker | Acceptance when unblocked |
|---|---|---|---|
| T-010 | Deploy the same compose file to a cheap dev box | user must provision a box (**Oracle Always Free A1** ARM attempt first — 4 OCPU/24 GB tier; **fallback Netcup Lite 1** 2 vCPU/4 GB ~₹470/mo; a 1 GB "pico" would OOM under faster-whisper small-int8, so it's explicitly out) — also note Oracle A1 free-tier idle-reclaim warning | `docker compose up` on the box; register+login green via the box's URL; no laptop-only state. Engine RTF measured on the real box before any public numbers |

## Planned (follow spec §5 milestones; open TASKS when slice starts)

| ID | Task | Milestone | Depends on |
|---|---|---|---|
| T-011 | LICENSE (AGPL-3.0) + TRADEMARKS.md + README v0 | **→ delivered 2026-10-24** (see completed table) | — |
| T-012 | Self-host compose v2: web + worker + db + MinIO + Caddy, migrations auto-run | **→ delivered 2026-10-24 (see completed table; storage = shared volume per D15, MinIO intentionally deferred)** | — |
| T-013 | Audio upload + S3/MinIO storage layer | **→ see "Days 4–6 pipeline slice" above (delivered 2026-10-24; fs adapter first, S3 swap when needed)** | — |
| T-014 | `jobs` table + plan-aware queue pop (SKIP LOCKED + lease TTL `locked_at`) | **→ delivered 2026-10-24 (plan-aware priority deferred to billing)** | T-013 |
| T-015 | Local engine runner (faster-whisper small-int8) + degenerate-output filter | **→ delivered 2026-10-24** | T-014 |
| T-016 | Notes: summaries + action items + dashboard share pages (list/search delivered as T-022) | Days 11–13 | T-015 |
| T-017 | Hosted metering + Paddle as merchant-of-record (Free 300 audio-min / Pro 4 000, self-host unlimited) | Days 8–13 | T-016 |
| T-018 | Real email delivery (Brevo/Resend; replaces console transport) | ~Day 15 | — |
| T-019 | Test suite (vitest/pytest) + CI; money/privacy paths red→green | **in-progress 2026-10-25** (vitest/pytest landed; CI next) | — |

Rules: new unplanned features require explicit user approval (spec §13 is
locked); each task ships as a PR-sized slice with checks run before "done".
