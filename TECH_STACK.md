# TECH STACK — Kioku

Everything verified against the npm registry (`pnpm view`) on **2026-10-22**:
exact version exists, license recorded. Add rows the same way — never pin an
unverified package (slopsquatting risk).

## Runtime deps (`app/package.json`, exact pins)

| Package | Version | License | Why |
|---|---|---|---|
| next | 15.5.9 | MIT | Plan pins Next 15 (16.4.2 exists; 15.5.9 is the maintained 15.x patch line, `backport` dist-tag still active) |
| react / react-dom | 19.3.1 | MIT | App Router current stable; peer range of next@15.5.9 verified `^19.0.0` |
| next-auth | 4.24.15 | ISC | Stable v4 (v5 still `5.0.0-beta.32`); hosts auth via Pages API route |
| @auth/drizzle-adapter | 1.11.3 | ISC | Email verificationToken storage + account linking |
| drizzle-orm / drizzle-kit | 0.45.4 / 0.31.11 | Apache-2.0 / MIT | Schema-in-TS, forward-only SQL migrations |
| postgres | 3.4.9 | Unlicense | postgres-js driver (ESM-friendly) |
| nodemailer | 7.0.13 | MIT-0 | Required peer: next-auth's email provider imports it top-level (custom console transport does the only sending today) |

## Dev deps (app)

| Package | Version | License | Why |
|---|---|---|---|
| typescript | 5.9.3 | Apache-2.0 | strict TS |
| tailwindcss + @tailwindcss/postcss | 4.3.3 | MIT | v4 via postcss plugin |
| drizzle-kit | 0.31.11 | MIT | generate/migrate CLI |
| tsx | 4.20.6 | MIT | runs `src/db/migrate.ts` (needs `"type": "module"`) |
| vitest | 5.0.5 | MIT | app unit + Postgres integration tests (`pnpm test`); verified on npm 2026-10-25 |
| @types/* (node 24.7.1, react 19.2.2, react-dom 19.2.1, nodemailer 7.0.4) | — | MIT/… | matching majors for the wheels above |

## Worker (`worker/pyproject.toml`, uv-managed, .python-version pins 3.12)

| Package | Constraint | License | Why |
|---|---|---|---|
| fastapi | >=0.115 | MIT | `/healthz` service; future job endpoint |
| uvicorn | >=0.30 (0.54.0 resolved) | BSD-3 | server |
| psycopg[binary] | >=3.2 | LGPL-3.0 | db checks + queue job leases |
| python-dotenv | >=1.0 | BSD-3 | loads `worker/.env` (process env still wins) |
| faster-whisper | ==1.2.1 (engine-local extra) | MIT | verified on PyPI 2026-10-23: current release, owner SYSTRAN/Guillaume Klein, wheel `py3-none-any`; decode via bundled FFmpeg (PyAV) — no system ffmpeg needed |
| av | ==14.2.0 (engine-local extra) | Apache-2.0 | newest PyAV in faster-whisper's tested window — 15+ removed the `metadata_errors` kwarg faster-whisper still passes, and cp314 wheels only start at PyAV 15.1 (hence the 3.12 pin) |
| pytest | >=9.1.1 (dev group) | MIT | worker queue/purge integration tests; verified 2026-10-25 |

## Infra & runtime

- **Postgres 16** via `postgres:16-alpine` (compose dev service; host port
  5433 — 5432 belongs to this machine's own system postgres). Search uses
  `pg_trgm` from the image's bundled contrib modules (migration `0003`) —
  no extra service or dependency.
- **Docker 29.1.3** + **Compose v5.6.1**: the distro's compose is EOL
  v1.29.2 (python), so the official v2 plugin is installed at user level
  (`~/.docker/cli-plugins/`) — future dev boxes should install
  `docker-compose-v2` or the same plugin.
- **Node 24.22.1 / pnpm 12.15.0** (dev runtime; pnpm pinned via
  `packageManager`). Node engines field & Dockerfile base image get decided
  at the Day-7 self-host slice.
- **Python 3.12 + uv** for the worker venv (pinned in `worker/.python-version`;
  3.14 was tried first — its wheel reality forces PyAV ≥15.1 which breaks
  faster-whisper; see the av row above).

## pnpm 12 facts captured for future installs

- Build scripts are default-deny: `pnpm-workspace.yaml` carries
  `allowBuilds: { esbuild: true, sharp: true }` (esbuild's native binary for
  drizzle-kit; sharp for next/image). New packages needing lifecycle scripts
  must be reviewed then added there — never `--dangerously-allow-all-builds`.
- Root workspace settings live in `pnpm-workspace.yaml` (pnpm 12), not the
  old `onlyBuiltDependencies` field.
