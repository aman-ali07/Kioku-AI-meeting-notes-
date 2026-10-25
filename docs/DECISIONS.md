# DECISIONS — Kioku (architecture decision record)

Ordered by occurrence in this session (2026-10-22). Supersedes nothing
previously recorded; the approved spec (§13 decisions) remains the product
source of truth — this file records *implementation* decisions made while
scaffolding it.

**D1 — Next.js 15.5.9, not 16.** Plan pinned Next 15; 16.4.2 exists but
approved scope wins. 15.x keeps receiving backports (dist-tag evidence);
upgrading is a conscious later move.

**D2 — next-auth v4.24.15 (stable), auth behind Pages API.** v5 is still
beta (5.0.0-beta.32). v4 coexists with App Router via
`src/pages/api/auth/[...nextauth].ts`. Consequence: nodemailer becomes a
real dependency (the email provider imports it top-level even with a custom
`sendVerificationRequest` — console transport). Initially pinned nodemailer
6, corrected to 7.0.13 after installing (peer range of next-auth + @auth/core
requires ^7: "pnpm peers check" was clean after the bump).

**D3 — JWT sessions + Drizzle adapter, hybrid.** Adapter exists for
verificationToken/backing OAuth; sessions stay stateless JWT. `user.id rides
the token (`uid` claim) → session augmentation — no session table reads.

**D4 — Adapter tables keep docs-exact names** (`user`, `account`, `session`,
`verificationToken`, camelCase columns): zero override mappings, fewer ways
to silently break the adapter. Kioku domain tables use snake_case names.

**D5 — Console magic-link transport (all envs, today).** The custom
`sendVerificationRequest` logs to the server console. Defers Brevo/Resend to
T-018 while guaranteeing: no misconfigured SMTP "success". Negative
consequence accepted: deployed boxes can't finish sign-up until T-018 or an
operator reads the log.

**D6 — Per-package `.env` files.** Next.js loads `.env` from its own
package dir; the worker loads its own via python-dotenv; root `.env.example`
was dropped so every var has exactly one documented source.

**D7 — Dev DB on host port 5433.** This machine's system Postgres owns
127.0.0.1:5432; compose maps 5433→5432 instead of fighting for it. Carried
across all `.env.example` files; irrelevant on clean boxes (still harmless).

**D8 — pnpm 12 default-deny build scripts, explicit allowlist.**
`allowBuilds: {esbuild, sharp}` in pnpm-workspace.yaml (pnpm 12's setting —
the older `onlyBuiltDependencies` proved ineffective on 12). Review any new
lifecycle package before allowing.

**D9 — `outputFileTracingRoot` pinned in next.config.mjs.** A stray
`/home/aman/package-lock.json` made Next infer the workspace root as $HOME.
Left the stray file alone (outside repo scope) and pinned root explicitly.

**D10 — `force-dynamic` on `/healthz`.** Prevents `next build` from
attempting to statically evaluate the GET handler (and thereby hitting the
DB at build time). Superseded detail: the earlier "lazy env accessors"
claim — db modules evaluate DATABASE_URL at module scope (see D13) — is a
documented build prerequisite, not an abstraction.

**D11 — Worker never owns DDL.** Drizzle owns schema; today `/healthz` does
`SELECT 1`; in Days 4–6 the worker consumes `jobs` rows via SQL
(SKIP LOCKED + `locked_at` leases, plan-aware priority) — no table creation
from Python, single migration record.

## 2026-10-23 — hardening decisions

**D12 — First-provisioning is lock-serialized.** `ensurePersonalWorkspace`
uses `pg_advisory_xact_lock(hashtext(userId))` and re-checks inside the
transaction. Rationale: without it, two concurrent first sign-ins mint two
"Personal" workspaces — harmless-looking at day 1, but a metering/billing
bug once `usage_meters` is per-workspace (the user's quota splits across two
rows). ~Zero ongoing cost; correctness bought before meters arrive.

**D13 — The lazy-db abstraction was refused, the constraint documented.**
Attempted a Proxy-lazy db client so builds never evaluated DATABASE_URL.
Drizzle interop? no — DrizzleAdapter introspects the instance's own
properties, so a proxy failed at runtime ("Unsupported database type").
Foundation: acceptable consequence of the module-scope client — builds/CI
need DATABASE_URL present (placeholder ok). Documented in client.ts +
TESTING.md and TRANSPARENTLY changed in TESTING.md where the smoke's
"provisioning exercised" claim overstated what the script actually asserted
(the script now binds the Postgres rows so the claim is real).

**D14 — Engines deferred to their milestone.** faster-whisper gets pinned
only when the engine-local extra arrives and its wheel + license are
verified (Days 4–6). Groq stays config-gated as the paid engine default
(spec §6); the summarizer line is planned as Groq `gpt-oss-120b`
(₹≈0.25/meeting) — Groq Llama 3.3 70B went enterprise-only (2026-08), so it
must not be re-spec'd.

**D15 — The differentiator ships free and boring-by-design (2026-10-24).**
Auto retention-purge + 1-click export are the launch wedge (Fireflies hides
auto-delete behind Enterprise and export behind paid — calibrated
2026-10-22). Choices worth re-reading later:
- **Purge sweeps hourly in the worker loop**, not cron/LISTEN: deletes
  meetings older than the workspace's `retention_days`, their blobs, and any
  queued jobs for them. **Never touches queued/processing meetings** — a
  purge must not race an active claim even at `retention_days=0`. Terminal
  `done/failed` job rows are kept as the record that a pipeline ran.
  Consequence (accepted): actual deletion can lag the policy by up to 1 h.
  `--purge-once` exists for ops/cron users — run it from any scheduler.
- **Per-file purge cleanup is best-effort but never silent**: an unreadable
  path logs and *blocks that meeting's row deletion* (no DB row without its
  blob purged, while ENOENT is treated as already-gone — the fs is the
  ledger).
- **Export = dependency-free STORE zip** (`app/src/lib/export-zip.ts`):
  compression buys nothing (audio dominates and is already compressed), so a
  ~60-line store-only writer with `zlib.crc32` (Node ≥ 20.15) beats a
  supply-chain dependency. Round-trip-proved with `python3 -m zipfile -t`
  before shipping; extend to deflate only with the same proof.
- Export sits behind the same session + workspace guard as reads;
  cross-workspace ids 404 without leaking existence.

## 2026-10-25 — search decisions

**D16 — Search is Postgres-native and render-safe.** The spec calls for
`tsvector` + `pg_trgm`; the implementation choices worth keeping:
- **Stored generated `tsvector` columns** on `meetings.title` and
  `transcript_segments.text`, not expression indexes. Generated columns are
  queryable directly and cannot drift from the source text; the GIN indexes
  target them. Cost accepted: adding a stored generated column rewrites the
  table (trivial now; batched later).
- **`pg_trgm` via a custom drizzle migration (`0003`)** because extensions
  can't be expressed in `schema.ts`. `drizzle-kit generate --custom` is the
  sanctioned exception to "never hand-edit SQL"; generated files are still
  never edited. The extension needs a role with install privileges (fine on
  the compose db, documented for managed Postgres).
- **Two queries merged in TypeScript** (titles; best segment per meeting via
  `DISTINCT ON`) instead of one CTE. Clearer to read and test; results are
  one row per meeting, title hits boosted, capped at 20 with no pagination
  in v1.
- **`ts_headline` sentinels → `{text, match}` parts**, rendered with React
  `<mark>`. No `dangerouslySetInnerHTML` path, so transcript text can never
  become markup.
- **Trigram covers title substrings only**; transcript search is whole-word
  English FTS in v1 (spec §13). Prefix/stemming expansion is a later change,
  not a silent config.
- **Tenant scoping is an argument**, not query text: `searchMeetings(
  workspaceId, q)` requires the id resolved from the session.

**D17 — Smoke login chain extracted before the third copy.** `smoke-auth.sh`
and `smoke-pipeline.sh` each carried the same magic-link flow; the search gate
would have made three. `scripts/lib/smoke-session.sh` now owns it. Both
existing gates were re-run after the refactor (auth PASS, pipeline PASS) so
the extraction is proven, not assumed.

