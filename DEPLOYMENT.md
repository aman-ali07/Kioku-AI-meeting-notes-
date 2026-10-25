# DEPLOYMENT — Kioku

## Environments (env-only config, never committed)

| Variable | Package | Required | Notes |
|---|---|---|---|
| `DATABASE_URL` | app + worker | yes | dev: `postgres://kioku:kioku@localhost:5433/kioku` (compose); selfhost: interpolated by compose |
| `NEXTAUTH_SECRET` | app | yes | generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |
| `NEXTAUTH_URL` | app | yes | the public origin users visit (behind the proxy in selfhost) |
| `STORAGE_DIR` | app + worker | yes | audio root; both MUST agree (app writes, worker reads) |
| `WHISPER_MODEL` | worker | no | default `small` (the verified engine pin) |
| `DEFAULT_RETENTION_DAYS` | app | no | new-workspace retention: unset/empty = forever (self-host default), `90` = cloud-free. Existing workspaces keep their stored value |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | app | no | env-gated Google sign-in; absent = feature absent |
| `HF_HOME` | worker (container) | no | set by the image to `/models` (volume-persisted model cache) |

## Local dev (proven on 2026-10-22; port note refreshed 2026-10-24)

```sh
pnpm install && docker compose up -d
pnpm db:migrate && pnpm dev
cd worker && uv run python pipeline.py   # the transcribe loop
```

Health: `:3000/healthz` (app) — `{db, storage}` both real. Port note:
`next dev` shares the host, so if another app already owns :3000 (this dev
box also runs one), bind Kioku deterministically instead of letting Next
pick a port (random ports silently break `NEXTAUTH_URL`):

```sh
cd app && PORT=3002 NEXTAUTH_URL=http://localhost:3002 pnpm dev
# then point the gates at it: bash scripts/smoke-pipeline.sh http://localhost:3002
```

The worker runs as a claim loop (no HTTP in the pipeline process).
Auth DoD: `bash scripts/smoke-auth.sh`; pipeline DoD:
`bash scripts/smoke-pipeline.sh`.

## Self-host (Day-7 compose v0 — verified 2026-10-24)

One stack, one file: `docker-compose.selfhost.yml` — web (standalone build)
+ worker (engine extra baked) + db + shared storage volume + Caddy proxy.

```sh
cp deploy/selfhost.env.example .env     # fill POSTGRES_PASSWORD, NEXTAUTH_SECRET, SITE, NEXTAUTH_URL
docker compose -f docker-compose.selfhost.yml up -d --build
```

Facts that matter to an operator:

- **Migrations run on boot** (one-shot `migrate` service ahead of web/worker;
  journal is idempotent — safe across upgrades).
- **Worker is supervised**: `restart: unless-stopped`. A crashed loop comes
  back, and the lease watchdog requeues anything it was holding.
- **Magic links print to `docker compose -f docker-compose.selfhost.yml
  logs -f web`** (console transport) until real email is wired (KI-1) —
  that also means: don't run a user-facing box before KI-1/KI-2.
- **First transcription downloads the model** (~460 MB) into the
  `model-cache` volume; expect the first job to take minutes, later jobs to
  reuse the cache.
- **Retention defaults to forever on self-host**: leave
  `DEFAULT_RETENTION_DAYS` empty (the compose default). Set it to `90` to
  mirror cloud-free. Existing workspaces from before migration `0005` keep
  their stored `90`; an operator who wants those meetings kept can run the
  deliberate one-time `UPDATE workspaces SET retention_days = NULL;` after
  confirming the policy.
- Storage is a shared named volume (`audio:/data/audio` in both containers).
  S3/R2 behind the same 3-op adapter stays a planned swap (D15).
- The `SITE`/`NEXTAUTH_URL` pair drives Caddy: a public DNS name gets
  automatic TLS; `localhost:8080` stays plain HTTP for local tests.
- Verification gate: `bash scripts/smoke-selfhost.sh` (register → magic
  link from container logs → upload → transcribe → export zip).

## Dev box (pending, T-010 — blocked on the box)

Same files, same commands, zero laptop-only state. Box assumptions:
2-core/4 GB is sufficient for Days 1–7 (db + Next dev/build); Docker Engine +
**Compose v2 plugin required** (the Ubuntu `docker-compose` v1.29.2 package
is EOL and lacks the `docker compose` subcommand — install
`docker-compose-v2` or the plugin binary, as done on this machine). The dev
compose exposes **5433**; the selfhost stack owns its own network/volumes
and coexists.

## Migrations & rollback

- Apply on deploy: `pnpm db:migrate` (or the selfhost container step).
- **Forward-only**: broken migration = fix-forward with a new file.
- Rollback of the stack = restore from backup (compose volume `db-data`;
  `pg_dump` snapshots are the recovery path).
- **Automated backups are not in compose v0** — scheduled `pg_dump` is a
  required pre-launch item (tracked in KNOWN_ISSUES before external users).
