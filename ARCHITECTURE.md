# ARCHITECTURE — Kioku

## Components (as of Days 4–6; planned items in *italics*)

```
              ┌────────────────────────────┐
 browser ──▶  │  app/  Next.js 15 (:3000)  │── schema/store ──▶ Postgres 16 (:5433)
   ▲  HTTPS   │  - App Router pages        │                      ▲   ▲
   │  (audio  │  - Pages API /api/auth/*   │                      │   │ claim loop (SKIP
   │   upload)│  - /api/upload (multipart) │                      │   │ LOCKED + lease)
   │          └────────────────────────────┘                      │   │
   │                  │ fs writes under STORAGE_DIR              │   │
   │                  ▼                                          │   │
   │          data/audio/<ws>/<meeting>.<ext> ──── reads ─────▶ faster-whisper small/int8 │
   └── transcript text shown back on /dashboard/meetings/<id> ◀───┘   │
                        worker FastAPI (:8009 healthz) + pipeline.py ─┘
 Planned (Days 8–13): browser recording + consent, workspace members/switcher,
 summaries/action items on top of segments; *storage→S3 driver swap behind the
 same 3-op adapter*; *plan-aware queue priority*.
```

## Layout

```
saas/
├── app/                  next "kioku-app"
│   ├── src/app/          App Router pages: /, /login, /dashboard,
│   │                     /dashboard/meetings/[id], /healthz
│   │                     + /api/upload, /api/search, /api/meetings/[id]/export
│   ├── src/pages/api/    next-auth v4 catch-all ([...nextauth]) — see DECISIONS #2
│   ├── src/db/           schema.ts (source of truth), client.ts, migrate.ts
│   ├── src/auth.ts       NextAuthOptions (email + env-gated Google, JWT strategy)
│   ├── src/provision.ts  ensurePersonalWorkspace (locking per D12)
│   ├── src/env.ts        env accessors (build prerequisite documented at D13)
│   ├── src/storage.ts    fs storage adapter (put/get/delete — R2 swaps in later)
│   ├── src/lib/          workspace.ts (tenant resolution), workspace-role.ts (write policy), search.ts (FTS/trigram)
│   ├── src/components/   download-free client bits (upload-form.tsx, sign-out-button)
│   ├── drizzle/          generated, forward-only SQL migrations (committed; 0000–0005)
│   └── .env / .env.example
├── worker/               python 3.12 (pinned via .python-version), uv-managed
│   ├── main.py           FastAPI app with truthful /healthz (db + storage checks)
│   ├── pipeline.py       queue consumer: claim loop + lease watchdog + transcription
│   ├── pyproject.toml    engine-local extra: faster-whisper 1.2.1 + av 14.2.0
│   └── .env / .env.example
├── scripts/
│   ├── lib/smoke-session.sh shared magic-link login for all smoke gates
│   ├── smoke-auth.sh     end-to-end auth gate (register+login+tenant rows)
│   ├── smoke-pipeline.sh end-to-end pipeline gate (upload→queue→transcribe→rows)
│   └── smoke-search.sh   FTS gate (title/transcript hits, cross-tenant, boundaries)
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
- **Env at module scope, documented honestly** (`src/env.ts`, D13): the db
  client and DrizzleAdapter require `DATABASE_URL` at import time, so builds
  carry it (placeholder suffices in CI); `/healthz` is `force-dynamic`.
  The lazy-proxy alternative was attempted and rejected — it broke the
  adapter's eager introspection; see D13 before re-attempting.

## Session + data flow (implemented)

1. User posts email at `/login` → `signIn("email", …)` (client) →
   `/api/auth/signin/email` (CSRF-checked) → email provider stores a
   verification token via the adapter.
2. Console transport prints the magic link to the server log (dev; real
   sender is a later milestone — see KNOWN_ISSUES).
3. User follows link → `/api/auth/callback/email` → adapter consumes token →
   `jwt` callback sets `uid`, provisions workspace if first sign-in →
   session cookie (`next-auth.session-token`, http-only by default).
4. `/dashboard` (`force-dynamic`) `getServerSession` → guarded; resolves the
   tenant via `getPrimaryWorkspace(userId)` (oldest membership,
   deterministically) and lists the workspace's meetings; the tenant card
   shows role/plan/retention.

## Search flow (implemented Days 8–10)

1. `/dashboard?q=` (server component) and `GET /api/search?q=` share one
   tenant-scoped path (`src/lib/search.ts`): `getPrimaryWorkspace` supplies
   the `workspace_id` filter — the client never selects a tenant.
2. `websearch_to_tsquery('english', q)` runs against generated `tsvector`
   columns on titles and segments (GIN); title substrings also use `ILIKE`
   backed by `pg_trgm`. Transcript matching is whole-word in v1.
3. Two queries (titles; best segment per meeting via `DISTINCT ON`) merge in
   TypeScript into one row per meeting, with title hits boosted and a cap of
   20 results.
4. `ts_headline` emits sentinel markers; the lib turns them into
   `{text, match}` parts and React renders `<mark>` — no HTML injection path.
5. Boundaries: 401 signed out, 403 no tenant, query trimmed, <2 chars →
   empty result, >200 chars → 400, LIKE metacharacters escaped.
6. Results deep-link to `/dashboard/meetings/<id>?seg=<idx>#seg-<idx>`,
   which highlights the matching segment.

## Pipeline flow (implemented Days 4–6)

1. `POST /api/upload` — session → `getPrimaryWorkspace` tenant guard →
   `canWriteToWorkspace` role guard (viewer → 403 before the body is read) →
   boundary checks (type allowlist, ≤50 MB, non-empty) → server-generated
   key `<workspaceId>/<meetingId>.<ext>` → write via the fs adapter
   (`STORAGE_DIR`, with a `..`-escape guard) → `meetings` row
   (`status=queued`) → `jobs` row (`kind=transcribe`,
   `payload={meetingId}`). A DB failure after a successful file write cleans
   up the orphan file; the on-disk size is re-verified as ground truth.
2. `worker/pipeline.py` loop — the watchdog first recovers `processing` jobs
   whose `locked_at` is older than 15 min. It enforces `MAX_ATTEMPTS` itself
   (a hard crash never reaches `fail_job`): below the cap the job returns to
   `queued` and its transcribe meeting to `queued`; at the cap both become
   `failed` — a poison job cannot crash-loop and starve the queue. Then it
   claims one job: `UPDATE jobs … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED
   LIMIT 1 RETURNING …)`; the claim increments `attempts` and returns it, so
   failure handling needs no second read. No job → sleep 2 s. No LISTEN/NOTIFY
   yet (deliberate: polling is audit-cheap and self-host-simple).
3. Job processing — resolve the meeting row (erroring out if gone), probe
   duration with PyAV (no system ffmpeg), transcribe with faster-whisper
   `small`/int8 on CPU (`vad_filter=True`), then replace
   `transcript_segments` **in one transaction**: delete, insert
   (`confidence = exp(avg_logprob)·100`), and stamp the meeting. A rejected
   row or crash mid-write rolls the whole set back — the previous transcript
   is never half-destroyed. Re-runs cannot collide with the unique
   `(meeting_id, idx)` index.
4. Degenerate-output filter (post-ASR, pre-summary — audit finding: never
   spend summary tokens on mush): empty set, mean confidence < 0.5, any
   exact line repeated > 8×, or >90% empty segments → `low_confidence`
   instead of `completed`. Segments are still kept for the user to read.
5. Completion — `jobs.status=done` only if the job is still `processing`
   (a late finisher leaves a moved job untouched). Retry semantics:
   exception → `last_error` recorded; attempts < 3 → job back to the queue
   **and** the meeting to `queued`; ≥ 3 → job `failed` and the meeting flips
   to `failed` (fail closed, visible in the UI). Job and meeting move in one
   transaction. The transition is kind- and status-scoped: only a
   `transcribe` job may touch meeting state, and only while the meeting is
   still in flight — a late retry failure can never overwrite an already
   completed transcript. Lease fencing for multiple workers is not
   implemented (KI-15); one worker is the documented deployment.
6. `/dashboard/meetings/<id>` — tenant-scoped read; another workspace's
   meeting id 404s (never leaks existence). Placeholder-Tailwind UI (KI-7).
7. **Retention purge** (hourly in the same loop; differentiator) — deletes
   meetings older than their workspace's `retention_days` (D15): blob,
   meeting row, and queued jobs. Queued/processing meetings are exempt
   (a purge must never race an active claim); `--purge-once` exists for
   ops/cron users.
8. **One-click full export** `GET /api/meetings/<id>/export` — transcript +
   metadata + original audio in a store-only zip built with `zlib.crc32`
   (no zip dependency — D15); same guards as reads, cross-tenant 404.

## `/healthz` contract (both services)

```json
{ "service": "…", "status": "ok | degraded",
  "checks": { "db": "ok | error", "storage": "ok | error" } }
```
HTTP 200 when every check passes; 503 on any failure (both paths verified
on both services). Storage checks are real in both since the upload/storage
slice: STORAGE_DIR must exist and be writable (the app writes, the worker
reads). Queue health intentionally isn't a boolean — a claim loop's liveness
shows in rows reaching terminal status, not in a check value.
