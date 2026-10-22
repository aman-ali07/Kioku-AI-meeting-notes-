# Kioku — Your meetings, remembered.

Self-hostable, open-source AI meeting-notes platform (the "Open-Source Fireflies"):
record or upload a meeting → transcribe locally (faster-whisper) → AI summaries &
action items → searchable team dashboard with shareable meeting pages.

**100% free core, unlimited, AGPL-3.0.** Hosted cloud at $6/user/mo sells operation
(setup, uptime, billing), never capability — nothing is gated from the open repo.

- Design & 30-day execution plan: [`docs/specs/2026-10-22-kioku-design.md`](docs/specs/2026-10-22-kioku-design.md)
- Status: transcription pipeline live (Days 4–6 of the plan complete) — register+login green locally; upload → queue → local transcription → transcript view all verified; summaries/actions next (Days 8–13)
- Differentiator slice next up after that: auto retention-purge + 1-click export
- License pending (plan Day 7): AGPL-3.0 core, TRADEMARKS.md to follow.

## Layout

| Path | What it is |
|---|---|
| `app/` | Next.js 15 web app (TypeScript, Tailwind, Drizzle, Auth.js magic-link + env-gated Google) |
| `worker/` | Python 3.12 worker (FastAPI `/healthz`) — claim-loop transcription (faster-whisper small/int8) |
| `docs/specs/` | Approved product spec |
| `docs/` + root `AGENTS.md`, `*.md` | Agent/human documentation set (see AGENTS.md for the routing map) |

## Project documentation

Start with `AGENTS.md` (routing map). Key files: `PRD.md` (what & why),
`ARCHITECTURE.md` (how), `TASKS.md` (status), `DATABASE.md`, `SECURITY.md`,
`TESTING.md`, `DEPLOYMENT.md`, `TECH_STACK.md`, `docs/DECISIONS.md`,
`CHANGELOG.md`, `KNOWN_ISSUES.md`.

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

Provable in two commands (dev server + compose db + worker loop running):

```sh
bash scripts/smoke-auth.sh     # healthz → providers → magic link → session → dashboard → tenant rows
bash scripts/smoke-pipeline.sh # upload → queue → faster-whisper → transcript rows in Postgres
```

`GET /healthz` — `{ status, checks: { db, storage, … } }`; 503 when the db is
down. Storage and worker checks are staged as `not-provisioned (Days 4–6)` —
same contract exists on the worker (`:8009/healthz`).

**Environment:** each package owns its `.env` (Next.js loads it from its own
directory; the worker reads its own). Config comes from the environment only —
no secrets in code.

## Migrations (forward-only)

Schema lives in `app/src/db/schema.ts`. After a schema change:

```sh
pnpm db:generate    # schema → SQL in app/drizzle/ (committed, no DB needed)
pnpm db:migrate     # apply pending migrations to the running Postgres
```
# Kioku-AI-meeting-notes-
# Kioku-AI-meeting-notes-
