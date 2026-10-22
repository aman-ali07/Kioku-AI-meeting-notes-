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

## Blocked

| ID | Task | Blocker | Acceptance when unblocked |
|---|---|---|---|
| T-010 | Deploy the same compose file to a cheap dev box | user must provision a box (Oracle Always Free A1 ARM attempt, or Netcup pico fallback) | `docker compose up` on the box; register+login green via the box's URL; no laptop-only state |

## Planned (follow spec §5 milestones; open TASKS when slice starts)

| ID | Task | Milestone | Depends on |
|---|---|---|---|
| T-011 | LICENSE (AGPL-3.0) + TRADEMARKS.md + README v0 | Day 7 | — |
| T-012 | Self-host compose v2: web + worker + db + MinIO + Caddy, migrations auto-run | Day 7 | T-011 |
| T-013 | Audio upload + S3/MinIO storage layer | Days 4–6 | — |
| T-014 | `jobs` table + plan-aware queue pop (SKIP LOCKED + lease TTL `locked_at`) | Days 4–6 | T-013 |
| T-015 | Local engine runner (faster-whisper small-int8) + degenerate-output filter | Days 4–6 | T-014 |
| T-016 | Notes: summaries + action items + dashboard meeting list/search/share | Days 8–13 | T-015 |
| T-017 | Hosted metering + Paddle as merchant-of-record (Free 300 audio-min / Pro 4 000, self-host unlimited) | Days 8–13 | T-016 |
| T-018 | Real email delivery (Brevo/Resend; replaces console transport) | ~Day 15 | — |
| T-019 | Test suite (vitest/pytest) + CI; money/privacy paths red→green | ≥ Day 7 | — |

Rules: new unplanned features require explicit user approval (spec §13 is
locked); each task ships as a PR-sized slice with checks run before "done".
