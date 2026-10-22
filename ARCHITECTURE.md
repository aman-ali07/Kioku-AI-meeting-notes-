# ARCHITECTURE — Kioku

## Components (as of Days 1–3; planned items in *italics*)

```
                        ┌─────────────────────────────┐
   browser ── HTTPS ──▶ │  app/  Next.js 15 (:3000)   │── SQL ──▶ Postgres 16 (:5433)
                        │  - App Router pages         │            ▲
                        │  - Pages API /api/auth/*    │            │ SELECT 1
                        │  (next-auth v4 handler)     │      ┌─────┴─────────┐
                        └─────────────────────────────┘      │ worker FastAPI │
                                                             │  /healthz :8009│
                                                             └────────────────┘
 Planned (Days 4–6): asset upload → MinIO/S3 blob storage; `jobs` rows popped
 by the worker (SKIP LOCKED + leases) → transcript segments → status flows
 observable on the dashboard. Not implemented yet.
```

## Layout

```
saas/
├── app/                  next "kioku-app"
│   ├── src/app/          App Router pages (/, /login, /dashboard) + /healthz
│   ├── src/pages/api/    next-auth v4 catch-all ([...nextauth]) — see DECISIONS #2
│   ├── src/db/           schema.ts (source of truth), client.ts, migrate.ts
│   ├── src/auth.ts       NextAuthOptions (email + env-gated Google, JWT strategy)
│   ├── src/provision.ts  ensurePersonalWorkspace (fail-closed, idempotent)
│   ├── src/env.ts        lazy env accessors (build never needs a live DB)
│   ├── drizzle/          generated, forward-only SQL migrations (committed)
│   ├── .env / .env.example
│   └── drizzle.config.ts / tsconfig / next.config.mjs / postcss.config.mjs
├── worker/               python 3.11 "kioku-worker"
│   ├── main.py           FastAPI app with truthful /healthz (db ok/503)
│   ├── pyproject.toml    uv-managed; engine extras arrive Days 4–6
│   └── .env / .env.example
├── scripts/smoke-auth.sh end-to-end auth gate (register+login)
├── docs/specs/           approved 30-day design spec
├── docker-compose.yml    dev/self-host db (postgres:16-alpine, host :5433)
└── (AGENTS.md, TASKS.md, …) agent documentation set
```

## Key decisions (see docs/DECISIONS.md for full list)

- **next-auth v4 stable** (not v5 beta) → auth lives in `src/pages/api/auth/`
  coexisting with App Router; `@auth/drizzle-adapter` with docs-exact table
  names (`user`, `account`, `session`, `verificationToken`): no override mapping.
- **JWT session strategy** with an adapter: `verificationToken` rows come from
  the email provider; sessions are stateless. `user.id` travels as the `uid`
  JWT claim → `session.user.id` (types augmented in `src/types/next-auth.d.ts`).
- **First sign-in provisioning**: `ensurePersonalWorkspace(userId)` (idempotent,
  additive-transactional) runs in the JWT callback; it fails closed — no DB,
  no sign-in. Currently the dashboard resolves tenancy via the single
  workspace of the user's membership.
- **Environments per package**: Next reads `.env` next to its package, the
  worker reads its own; root `.env.example` dropped to keep one source each.
- **Lazy env validation** (`src/env.ts`): validated at first use so `next
  build` never needs a live DB; `/healthz` is `force-dynamic` for the same
  reason.

## Session + data flow (implemented)

1. User posts email at `/login` → `signIn("email", …)` (client) →
   `/api/auth/signin/email` (CSRF-checked) → email provider stores a
   verification token via the adapter.
2. Console transport prints the magic link to the server log (dev; real
   sender is a later milestone — see KNOWN_ISSUES).
3. User follows link → `/api/auth/callback/email` → adapter consumes token →
   `jwt` callback sets `uid`, provisions workspace if first sign-in →
   session cookie (`next-auth.session-token`, http-only by default).
4. `/dashboard` (`force-dynamic`) `getServerSession` → guarded; joins
   `workspace_members ⇒ workspaces` for the tenant row it displays.

## `/healthz` contract (both services)

```json
{ "service": "…", "status": "ok | degraded",
  "checks": { "db": "ok | error", "storage": "not-provisioned (Days 4–6)" } }
```
HTTP 200 when every present check passes; 503 on any check failure (worker
verified both paths). Storage/queue checks activate with their milestones and
are staged honestly as not-provisioned meanwhile — never faked green.

## Planned pipeline shape (Days 4–6; not implemented yet)

upload → row in `jobs` → worker pops with `FOR UPDATE SKIP LOCKED` +
lease TTL (`locked_at`, plan-aware priority: paid first) → local
faster-whisper transcribes → rows in transcript segments → degraded-output
filter → status transitions observable on the dashboard. Schema lands as a
new forward-only migration; the worker *consumes* the db via SQL and never
creates/migrates schema (Drizzle owns DDL).
