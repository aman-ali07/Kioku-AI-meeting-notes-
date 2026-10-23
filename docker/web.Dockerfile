# syntax=docker/dockerfile:1
# Kioku web (Next.js 15, standalone output). Build context: repo root —
# the pnpm workspace lockfile lives there.
#
# Targets:
#   deps      node_modules layer (cache key: lockfile)
#   build     compiles next (standalone) on top of deps
#   toolchain build's filesystem kept whole: full node_modules incl. tsx/
#             drizzle-kit — runs the one-shot `migrate` compose service
#   run (default) slim runtime: standalone server + static assets only

FROM node:24-alpine AS deps
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY app/package.json app/package.json
RUN corepack enable && pnpm install --frozen-lockfile

FROM deps AS build
# D13: module-scope env must exist at build time (documented placeholder —
# nothing connects here; pages are dynamic and get REAL env at runtime).
ENV DATABASE_URL=postgres://build-placeholder@localhost/build-placeholder \
    NEXTAUTH_SECRET=build-placeholder-modulescope-env-d13 \
    NEXTAUTH_URL=http://localhost:3000
COPY . .
RUN pnpm --filter kioku-app build

FROM deps AS toolchain
# Same source copy as build — the migrate one-shot runs tsx over
# app/src/db/migrate.ts, so a manifest-only stage would be missing it.
COPY . .

FROM node:24-alpine AS run
WORKDIR /srv
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
# Tracing root = pnpm workspace root → monorepo layout: the app's server is
# at <standalone>/app/server.js, static assets belong next to it, and the
# traced node_modules (incl. the pnpm .pnpm store) sits at the standalone root.
COPY --from=build /repo/app/.next/standalone ./
COPY --from=build /repo/app/.next/static ./app/.next/static
# Seed the storage dir as `node` BEFORE dropping privileges: an empty named
# volume copies the image's dir — including ownership — on first use. Without
# this, a root-owned first-mount volume makes the uid-1000 app EACCES
# ("/healthz storage check" fails + uploads impossible). Existing volumes
# created before this line keep root ownership — recreate them once.
RUN mkdir -p /data/audio && chown node:node /data/audio
USER node
# Next-auth's email console transport prints magic links to stdout — visible
# via `docker compose logs web` (KI-1: prod email lands later).
CMD ["node", "app/server.js"]
