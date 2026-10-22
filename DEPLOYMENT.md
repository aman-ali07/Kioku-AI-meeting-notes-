# DEPLOYMENT — Kioku

## Environments (env-only config, never committed)

| Variable | Package | Required | Notes |
|---|---|---|---|
| `DATABASE_URL` | app + worker | yes | dev: `postgres://kioku:kioku@localhost:5433/kioku` (compose) |
| `NEXTAUTH_SECRET` | app | yes | generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |
| `NEXTAUTH_URL` | app | yes | e.g. `http://localhost:3000` or the dev-box URL |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | app | no | env-gated Google sign-in; absent = feature absent |
| *(later)* SMS/EMAIL_FROM, storage creds, billing keys | — | — | land with their milestones; documented then |

## Local dev (proven on 2026-10-22)

```sh
pnpm install && docker compose up -d
pnpm db:migrate && pnpm dev
```

Health: `:3000/healthz` (app) and `:8009/healthz` (worker, if running) —
503 on db failure on both. Auth DoD reproduction: run the dev server and
`bash scripts/smoke-auth.sh`.

## Dev box (pending, T-010 — blocked on the box)

Same files, same commands, zero laptop-only state. Box assumptions:
2-core/4 GB is sufficient for Days 1–7 (db + Next dev/build); Docker Engine +
**Compose v2 plugin required** (the Ubuntu `docker-compose` v1.29.2 package
is EOL and lacks the `docker compose` subcommand — install
`docker-compose-v2` or the plugin binary, as done on this machine). Postgres
port: compose exposes **5433** — makes host-conflicts (common on existing
servers) a non-issue on the box too.

## Self-host "one command" (planned, Day 7 — T-012)

`web + worker + db + MinIO + Caddy` compose, migrations applied
automatically on boot, healthz contract identical. The Day-1–3 compose
intentionally contains only the db: the full stack lands assembled + tested
as a package, not piecemeal.

## Migrations & rollback

- Apply on deploy: `pnpm db:migrate` (or the Day-7 container step).
- **Forward-only**: broken migration = fix-forward with a new file.
- Rollback of the stack = restore from backup (compose volume `db-data`;
  `pg_dump` snapshots are the standing recovery path once real data exists).
- Before first external users, add a scheduled `pg_dump` task (Day 7 slice).
