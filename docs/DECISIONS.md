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

**D10 — Lazy env validation + `force-dynamic` on `/healthz`.** Prevents
`next build` from requiring a live DB (Next can statically evaluate GET
route handlers otherwise).

**D11 — Worker never owns DDL.** Drizzle owns schema; today `/healthz` does
`SELECT 1`; in Days 4–6 the worker consumes `jobs` rows via SQL
(SKIP LOCKED + `locked_at` leases, plan-aware priority) — no table creation
from Python, single migration record.

**D12 — Engines deferred.** faster-whisper gets pinned only when the
engine-local extra arrives and its wheel + license are verified (Days 4–6).
Groq stays config-gated as the paid engine default (spec §6).
