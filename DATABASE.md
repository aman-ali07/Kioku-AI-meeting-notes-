# DATABASE — Kioku

Postgres-only. Schema source of truth: `app/src/db/schema.ts` (Drizzle,
TypeScript). Python never owns DDL: the worker reads rows when the queue
lands (Days 4–6) and must never `CREATE TABLE`.

## Current tables (migration `app/drizzle/0000_wonderful_james_howlett.sql`, applied)

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

### Kioku domain (day-1 subset)

- **`workspaces`** — `id` uuid PK default random; `name`; `billing_plan`
  text (`free` \| `pro`, default `free`); `retention_days` int default 90;
  `created_by` text nullable → user.id (set null on user delete); `created_at`
  timestamptz default now.
- **`workspace_members`** — `workspace_id` → workspaces.id (cascade);
  `user_id` → user.id (cascade); `role` text one of
  `owner | member | viewer` (default `member`); `created_at`; unique index
  `workspace_members_ws_user_uq (workspace_id, user_id)`.

Relationships: user 1—1(+first) memberships N workspaces by way of
memberships; deleting a user cascades its memberships and accounts/tokens.
Reviews: retention_days is per-workspace *policy storage* — enforcement
arrives with meetings (Days 4–6).

## Workflow

```sh
pnpm db:generate     # schema.ts diff → new app/drizzle/NNNN_*.sql (+ meta snapshot)
pnpm db:migrate      # apply pending migrations (loads app/.env for DATABASE_URL)
```

- **Forward-only policy**: never edit an applied `NNNN_*.sql`; fix-forward by
  generating a new migration. The `drizzle` folder is committed.
- Verification habit after schema changes:
  `docker compose exec db psql -U kioku -d kioku -c '\dt'` (and `\d <table>`).

## Planned (composed when their milestone opens; not present today)

`meetings`, `transcript_segments`, `summaries`, `action_items`,
`share_links`, `api_keys`, `jobs` (queue + lease columns),
`usage_meters`, `subscriptions` — per spec §7. Each lands as its own
forward-only migration.
