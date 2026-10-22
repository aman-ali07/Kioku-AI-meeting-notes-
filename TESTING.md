# TESTING — Kioku

## What is proven today (2026-10-22, with real runs)

| Check | Command | Proves |
|---|---|---|
| Type safety gate | `pnpm typecheck` (`tsc --noEmit`) | Exit 0 — no TS errors |
| Production build gate | `pnpm build` | Next compiles; `/` static; `/login`, `/dashboard`, `/healthz` dynamic |
| Schema → migration | `pnpm db:generate` + `pnpm db:migrate` | 6 tables exist via `psql \dt` |
| **Auth end-to-end** | `bash scripts/smoke-auth.sh` | healthz → providers → CSRF → signed-in email request → **offset-fresh** magic link from console transport → callback cookie → `session` returns `user.id` → dashboard 200 → **DB assertion: owner-membership row for the session's uid in Postgres**. **PASS** on a fresh registration address — provisioning is bound by the gate, not assumed |
| Tenant provisioning | psql join query | `Personal` workspace row, `billing_plan=free`, owner membership tied to the session's user id |
| Worker health (positive) | `uv run uvicorn main:app --port 8009` + curl | `200 {db:"ok"}` |
| Worker health (negative) | same with unreachable `DATABASE_URL` | `503 {db:"error"}` (error detail only in server logs — non-sensitive response) |

## Rules

- **Smoke before claims**: any change to auth, provisioning, or health paths
  re-runs `scripts/smoke-auth.sh` (app) and the worker check before "done".
  The script asserts tenant rows in Postgres itself (psql owner-membership
  check for the session uid) — a dashboard 200 alone is NOT proof.
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
