# KNOWN ISSUES — Kioku

Confirmed limitations, open bugs, and unanswered questions. Everything here
is real and tracked; move items to CHANGELOG when fixed.

## Product-integrity risks (fix before external users)

- **KI-1 No prod email delivery.** Magic links print to the server console
  only (D5). A deployed box without T-018 wired can't complete sign-up.
- **KI-2 No rate limiting on `POST /api/auth/signin/email`** — on a deployed
  box this is a mail-bomb vector; fix before or with T-018. Also true today
  (pre-T-018): each valid-CSRF POST writes a `verificationToken` row (v4
  never purges expired rows) — unbounded table/log growth from scriptable
  abuse; needs the same rate-limit slice.
- **KI-3 No automated security/behavior test suite** — smoke-auth covers the
  happy path only; money/privacy red→green tests land later (T-019).
- **KI-4 No CI** — checks are local runs only.

## Functional limitations (accepted for now)

- KI-5 Google sign-in is env-gated and **untested live** (no dev
  credentials exist locally) — the provider/auth plumbing is smoke-covered
  via the email path only.
- KI-6 The **worker is an unsupervised loop**: `uv run python pipeline.py`
  must be running or nothing transcribes (dev box needs supervision —
  arrives with the self-host compose v2 at T-012). Queue checks in
  `/healthz` remain judge-by-results (storage/db checks are real now).
- KI-7 UI is placeholder Tailwind (landing/login/dashboard + meeting views)
  — the real design system arrives with the UI milestone; current
  accessibility is semantic-but-unpolished.
- KI-8 **No automated backups in the self-host stack** (compose v0 ships
  db-data/audio/model-cache volumes but no scheduled `pg_dump` sidecar).
  Manually `docker compose exec db pg_dump …` works today; automation is
  required before any external users.
- KI-8 LICENSE + TRADEMARKS.md don't exist yet (Day 7): treat the repo as
  source-available-by-intent until AGPL-3.0 lands. Keep marketing claims out
  until then.

## Environment facts (this dev machine)

- KI-9 System Postgres occupies host :5432 — Kioku dev db maps :5433
  (compose). Don't "fix" the ports without reading D7.
- KI-10 Distro compose is v1.29.2 (EOL); official Compose v5.6.1 binary is
  installed at user level (`~/.docker/cli-plugins/`). Dev boxes need the v2
  plugin (DEPLOYMENT.md).
- KI-11 Stray `/home/aman/package-lock.json` outside the repo previously
  caused Next to misdetect the workspace root; mitigated by pinning
  `outputFileTracingRoot` (D9). The stray file belongs to the user — do not
  delete it.
- KI-12 The dev server's console magic links are extracted from
  `SMOKE_LOG`; deleting that file while the server runs detaches its fd
  (truncate instead). Smoke script documents this contract.

## Open questions

- Q1 Dev box choice/availability (Oracle Always Free A1 ARM 4 OCPU first,
  Netcup **Lite 1** 2 vCPU/4 GB fallback; 1 GB "pico" ruled out — OOM risk
  under small-int8) — blocks T-010.
- Q2 **Engine RTF budget on the 2-vCPU box**: the pin/license/wheel question
  is settled (D14/Faster-whisper 1.2.1 verified, PASS runs on this dev
  machine) — what remains is a measured RTF on a real ~1 h file on the
  actual target hardware BEFORE any campaign number is published
  (~₹0.25/meeting summarizer math comes after that measure).
