# Kioku — Your meetings, remembered.

Self-hostable, open-source AI meeting-notes platform (the "Open-Source Fireflies"):
record or upload a meeting → transcribe locally (faster-whisper) → AI summaries &
action items → searchable team dashboard with shareable meeting pages.

**100% free core, unlimited, AGPL-3.0.** Hosted cloud at $6/user/mo sells operation
(setup, uptime, billing), never capability — nothing is gated from the open repo.

- Design & 30-day execution plan: [`docs/specs/2026-10-22-kioku-design.md`](docs/specs/2026-10-22-kioku-design.md)
- Status: scaffold (Days 1–3 of the plan)
- License pending (plan Day 7): AGPL-3.0 core, TRADEMARKS.md to follow.

## Layout

| Path | What it is |
|---|---|
| `app/` | Next.js 15 web app (TypeScript, Tailwind, Drizzle, Auth.js magic-link + env-gated Google) |
| `worker/` | Python 3.11 worker (FastAPI) — transcription pipeline (Days 4–6) |
| `docs/specs/` | Approved product spec |

## Quickstart (dev)

```sh
pnpm install
docker compose up -d      # Postgres 16 on localhost:5432
cp app/.env.example app/.env   # then set NEXTAUTH_SECRET inside it
pnpm db:migrate           # apply migrations (app/drizzle/*.sql)
pnpm dev                  # Next.js on http://localhost:3000
```

Generate a dev secret:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Magic-link emails are printed to the dev-server console (no SMTP needed locally).
Sign in at http://localhost:3000/login, open the link from the console — you're
in, with a "Personal" workspace provisioned on first sign-in.

`GET /healthz` — `{ status, checks: { db, storage, … } }`; 503 when the db is
down. Storage and worker checks are staged as `not-provisioned (Days 4–6)`.

**Environment:** each package owns its `.env` (Next.js loads it from its own
directory; the worker reads its own). Config comes from the environment only —
no secrets in code.

## Migrations (forward-only)

Schema lives in `app/src/db/schema.ts`. After a schema change:

```sh
pnpm db:generate    # schema → SQL in app/drizzle/ (committed, no DB needed)
pnpm db:migrate     # apply pending migrations to the running Postgres
```
