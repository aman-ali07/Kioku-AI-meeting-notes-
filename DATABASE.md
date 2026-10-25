# DATABASE — Kioku

Postgres-only. Schema source of truth: `app/src/db/schema.ts` (Drizzle,
TypeScript). Python never owns DDL: the worker reads rows when the queue
lands (Days 4–6) and must never `CREATE TABLE`.

## Current tables (migrations `0000`–`0005` applied; schema source: `app/src/db/schema.ts`)

### Auth.js adapter tables

Names/columns match `@auth/drizzle-adapter` documented defaults exactly, so
`DrizzleAdapter(db)` needs **no table-override mapping**:

- **`user`** — `id` text PK (default `crypto.randomUUID()`), `name`, `email`
  unique, `emailVerified` timestamp, `image` (all nullable except id).
- **`account`** — `userId` → user.id (cascade), `type` text constrained by
  `AdapterAccount["type"]` union, `provider`, `providerAccountId`,
  `refreshToken`, `accessToken`, `expiresAt` integer (epoch s), `tokenType`,
  `scope`, `idToken`, `sessionState`; composite PK
  `(provider, providerAccountId)`.
- **`session`** — `sessionToken` text PK, `userId` → user.id (cascade),
  `expires` notNull. *Unused by the runtime JWT strategy; kept adapter-exact
  for OAuth flows that need it.*
- **`verificationToken`** — `identifier`, `token`, `expires`; composite PK
  `(identifier, token)`. Magic-link storage (backend of the email provider).

### Kioku domain

- **`workspaces`** — `id` uuid PK default random; `name`; `billing_plan`
  text (`free` \| `pro` \| `team` \| `selfhost` — TS union widened for the
  pricing vocabulary; deliberately *no* DB CHECK constraint until billing
  stabilizes, per the schema comment); `retention_days` int **nullable** —
  `NULL` means keep forever (the self-host default), a positive integer means
  purge meetings older than that many days (cloud-free provisioning sets 90
  via `DEFAULT_RETENTION_DAYS`); `created_by` text nullable → user.id (set
  null on user delete); `created_at` timestamptz default now. Migration `0005`
  dropped the old `NOT NULL DEFAULT 90`.
- **`workspace_members`** — `workspace_id` → workspaces.id (cascade);
  `user_id` → user.id (cascade); `role` text one of
  `owner | member | viewer` (default `member`); `created_at`; unique index
  `workspace_members_ws_user_uq (workspace_id, user_id)`.
- **`meetings`** (migration `0001`) — `id` uuid PK; `workspace_id` →
  workspaces.id (cascade); `title` text notNull; `status` text
  (`uploaded | queued | processing | completed | low_confidence | failed`,
  default `uploaded`); `source` text (`upload | recording`, default
  `upload`); `audio_key` text (storage key, server-generated, never a client
  filename); `duration_ms` int (worker-probed via PyAV); `created_by` text
  nullable → user.id (set null); `created_at`; `started_at` timestamptz
  nullable; `search_vector` `tsvector` **generated always** from
  `to_tsvector('english', title)` (D16). Plain (non-unique) index
  `meetings_ws_created_idx (workspace_id, created_at)` — a UNIQUE there
  would reject two meetings created in the same millisecond (fixed in
  migration `0002` after I initially typed both as unique — fix-forward
  demonstration). Plus `meetings_search_idx` (GIN on `search_vector`) and
  `meetings_title_trgm_idx` (GIN `title gin_trgm_ops`).
- **`transcript_segments`** (migration `0001`) — `id` uuid PK;
  `meeting_id` → meetings.id (cascade); `idx` int notNull; `start_ms`,
  `end_ms` int notNull; `speaker_idx` int default 0 (manual split for now —
  no diarization on CPU per spec); `text` text notNull; `confidence` int
  0–100 (`exp(avg_logprob)·100` from faster-whisper); `search_vector`
  `tsvector` **generated always** from `to_tsvector('english', text)`.
  Unique index `transcript_segments_meeting_idx_uq (meeting_id, idx)` —
  legitimately unique; the worker deletes-then-reinserts a meeting's set
  (re-runs must not collide). Plus `transcript_segments_search_idx` (GIN on
  `search_vector`).
- **`jobs`** (migration `0001`) — `id` uuid PK; `kind` text
  (`transcribe`); `payload` jsonb notNull (`{ meetingId }` — the worker
  resolves the meeting row from the DB instead of trusting denormalized
  data); `status` text (`queued | processing | done | failed`, default
  `queued`); `attempts` int default 0; `locked_at` timestamptz (lease
  marker; watchdog requeues leases > 15 min); `last_error` text;
  `created_at`. Plain index `jobs_status_created_idx (status, created_at)`
  for the claim query (same unique→plain fix-forward as above).

Relationships: user 1—1(+first) memberships N workspaces by way of
memberships; deleting a user cascades its memberships and accounts/tokens.
Deleting a meeting cascades its transcript segments; deleting a workspace
cascades its meetings. `jobs` has **no FK to meetings** on purpose — a job's
terminal failure must be recorded even if the meeting row is deleted first
(the worker falls back to a not-found error and just marks the job).

### Search (migrations `0003`–`0004`, D16)

- `0003_enable_pg_trgm.sql` is a **custom** drizzle-kit migration
  (`--custom`) because extensions can't be expressed in `schema.ts`. It runs
  `CREATE EXTENSION IF NOT EXISTS pg_trgm`. Installing an extension needs a
  role with that privilege — fine on the compose Postgres (the `kioku` role
  owns the database); a managed Postgres must allow `pg_trgm`.
- `0004_search_vectors.sql` adds the two generated `tsvector` columns and
  three GIN indexes. Adding a stored generated column rewrites the table —
  trivial at current size, a batched plan once tables grow.
- Query shape: `websearch_to_tsquery('english', q)` for words (title +
  transcript) and trigram-backed `title ILIKE` for partial titles. Results
  are grouped per meeting in `app/src/lib/search.ts`; transcripts are
  whole-word v1 (no prefix search).

## Workflow

```sh
pnpm db:generate     # schema.ts diff → new app/drizzle/NNNN_*.sql (+ meta snapshot)
pnpm db:migrate      # apply pending migrations (loads app/.env for DATABASE_URL)
```

- **Forward-only policy**: never edit an applied `NNNN_*.sql`; fix-forward by
  generating a new migration. The `drizzle` folder is committed.
- **Custom migrations only for what `schema.ts` can't express** (Postgres
  extensions today); everything else must come from `db:generate`.
- Verification habit after schema changes:
  `docker compose exec db psql -U kioku -d kioku -c '\dt'` (and `\d <table>`).

## Planned (composed when their milestone opens; not present today)

`summaries`, `action_items`, `share_links`, `api_keys`,
`usage_meters`, `subscriptions` — per spec §7. Each lands as its own
forward-only migration.
