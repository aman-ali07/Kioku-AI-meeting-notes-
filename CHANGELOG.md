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

### Known gaps → see KNOWN_ISSUES.md (license still pending, plan Day 7).
