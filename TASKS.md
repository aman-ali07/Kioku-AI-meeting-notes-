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
| T-016-not-yet | Summaries + action items + search/share | planned | Days 8–13 milestone (T-016 in the table below) — this slice only delivered the transcript plumbing it lists as its prerequisite |

## Blocked

| ID | Task | Blocker | Acceptance when unblocked |
|---|---|---|---|
| T-010 | Deploy the same compose file to a cheap dev box | user must provision a box (**Oracle Always Free A1** ARM attempt first — 4 OCPU/24 GB tier; **fallback Netcup Lite 1** 2 vCPU/4 GB ~₹470/mo; a 1 GB "pico" would OOM under faster-whisper small-int8, so it's explicitly out) — also note Oracle A1 free-tier idle-reclaim warning | `docker compose up` on the box; register+login green via the box's URL; no laptop-only state. Engine RTF measured on the real box before any public numbers |

## Planned (follow spec §5 milestones; open TASKS when slice starts)

| ID | Task | Milestone | Depends on |
|---|---|---|---|
| T-011 | LICENSE (AGPL-3.0) + TRADEMARKS.md + README v0 | Day 7 | — |
| T-012 | Self-host compose v2: web + worker + db + MinIO + Caddy, migrations auto-run | Day 7 | T-011 |
| T-013 | Audio upload + S3/MinIO storage layer | **→ see "Days 4–6 pipeline slice" above (delivered 2026-10-24; fs adapter first, S3 swap when needed)** | — |
| T-014 | `jobs` table + plan-aware queue pop (SKIP LOCKED + lease TTL `locked_at`) | **→ delivered 2026-10-24 (plan-aware priority deferred to billing)** | T-013 |
| T-015 | Local engine runner (faster-whisper small-int8) + degenerate-output filter | **→ delivered 2026-10-24** | T-014 |
| T-016 | Notes: summaries + action items + dashboard meeting list/search/share | Days 8–13 | T-015 |
| T-017 | Hosted metering + Paddle as merchant-of-record (Free 300 audio-min / Pro 4 000, self-host unlimited) | Days 8–13 | T-016 |
| T-018 | Real email delivery (Brevo/Resend; replaces console transport) | ~Day 15 | — |
| T-019 | Test suite (vitest/pytest) + CI; money/privacy paths red→green | ≥ Day 7 | — |

Rules: new unplanned features require explicit user approval (spec §13 is
locked); each task ships as a PR-sized slice with checks run before "done".
