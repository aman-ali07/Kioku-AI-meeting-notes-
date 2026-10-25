# Kioku — Your meetings, remembered.

Self-hostable, open-source AI meeting-notes platform (the "Open-Source Fireflies"):
record or upload a meeting → transcribe locally (faster-whisper) → AI summaries &
action items → searchable team dashboard with shareable meeting pages.

**100% free core, unlimited, AGPL-3.0.** Hosted cloud at $6/user/mo sells operation
(setup, uptime, billing), never capability — nothing is gated from the open repo.

- Design & 30-day execution plan: [`docs/specs/2026-10-22-kioku-design.md`](docs/specs/2026-10-22-kioku-design.md)
- Status: **transcription + retention/export + search delivered** (Days 4–10 slices) — register+login, upload → queue → local transcription → transcript view, **auto retention-purge** (per-workspace `retention_days`, free — Fireflies charges Enterprise for this), **1-click full export** (transcript + metadata + audio zip, also free), and **Postgres FTS/trigram search** across meeting titles and transcripts, all verified end-to-end. Browser recording, workspace members/switcher, then summaries/actions (Days 8–13).
- License: **AGPL-3.0** (`LICENSE`) + `TRADEMARKS.md` (name/logo outside the §7e grant). The core is never feature-gated.

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
docker compose up -d      # Postgres 16 on localhost:5433 (5432 often taken on dev boxes)
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

`GET /healthz` — `{ status, checks: { db, storage } }` on both the app and the
worker; 503 when any check fails. Both checks are real (storage = STORAGE_DIR
must exist and accept writes).

**Environment:** each package owns its `.env` (Next.js loads it from its own
directory; the worker reads its own). Config comes from the environment only —
no secrets in code.

## Migrations (forward-only)

Schema lives in `app/src/db/schema.ts`. After a schema change:

```sh
pnpm db:generate    # schema → SQL in app/drizzle/ (committed, no DB needed)
pnpm db:migrate     # apply pending migrations to the running Postgres
```

## Self-host (the one-command deployment)

```sh
cp deploy/selfhost.env.example .env   # fill POSTGRES_PASSWORD + NEXTAUTH_SECRET (+ SITE for TLS)
docker compose -f docker-compose.selfhost.yml up -d --build
```

Same stack everywhere: standalone Next web, supervised transcription worker,
Postgres with one-shot automatic migrations, a shared audio volume, and Caddy
in front (automatic TLS when `SITE` is a public DNS name). **New self-host
workspaces keep meetings forever by default** (`DEFAULT_RETENTION_DAYS`
unset); set it to `90` to mirror the cloud-free policy. Magic links print to
`docker compose -f docker-compose.selfhost.yml logs -f web` until real email
lands; the first transcription downloads the model (~460 MB) into a cached
volume. The whole stack is provable:

```sh
bash scripts/smoke-selfhost.sh   # register → upload → transcribe → export through the proxy
```

Operator details, env table, and the box requirements live in
[`DEPLOYMENT.md`](./DEPLOYMENT.md).

## License

Code is AGPL-3.0-or-later (see `LICENSE`). The Kioku name and logo are **not**
covered by that grant — see `TRADEMARKS.md` for what you may call your fork
and deployment.
