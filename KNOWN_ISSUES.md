# KNOWN ISSUES — Kioku

Confirmed limitations, open bugs, and unanswered questions. Everything here
is real and tracked; move items to CHANGELOG when fixed.

## Product-integrity risks (fix before external users)

- **KI-1 No prod email delivery.** Magic links print to the server console
  only (D5). A deployed box without T-018 wired can't complete sign-up.
- **KI-2 No rate limiting on `POST /api/auth/signin/email`** — an open relay
  for mail-spam on a deployed box; fix before or with T-018.
- **KI-3 No automated security/behavior test suite** — smoke-auth covers the
  happy path only; money/privacy red→green tests land later (T-019).
- **KI-4 No CI** — checks are local runs only.

## Functional limitations (accepted for now)

- KI-5 Google sign-in is env-gated and **untested live** (no dev
  credentials exist locally) — the provider/auth plumbing is smoke-covered
  via the email path only.
- KI-6 `/healthz` storage/queue checks are staged "not-provisioned" until
  Days 4–6 milestones land them.
- KI-7 UI is placeholder Tailwind (landing/login/dashboard) — the real
  design system arrives with the UI milestone; current accessibility is
  semantic-but-unpolished.
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

- Q1 Dev box choice/availability (Oracle Always Free A1 vs Netcup pico) —
  blocks T-010.
- Q2 Days 4–6 engine: verify faster-whisper wheel/license + RTF budget on
  2-core box before pinning (T-015).
