# PRD — Kioku (product requirements)

Derived from the approved spec `docs/specs/2026-10-22-kioku-design.md`
(v1.1, 2026‑10‑22). Features marked **[scaffold]** are implemented and
verified; **[planned]** items exist in the spec but have no code yet — do not
treat them as done until `TASKS.md` says so.

## Problem statement

Meeting-recording tools (Otter, Fireflies) are closed, expensive per seat, and
can't be self-hosted. Teams and individuals who take meeting notes for
decisions don't control where their transcripts live, can't process offline or
cheap audio, and pay per-minute/per-seat premiums for features that are now
commodity (local whisper + an LLM call).

## Target users

1. **Self-hosters / privacy-minded teams** — control transcripts end-to-end,
   unlimited usage on their own box.
2. **Students / solo builders / small teams** — near-zero budget; want good
   meeting summaries and searchable history without SaaS pricing.
3. **Hosted-cloud users** — same product, zero setup, $6/user/mo when
   running your own box is not interesting.

## Product promise

- 100% free, fully self-hostable core, unlimited usage — **never feature-gated**.
- AGPL-3.0 core (LICENSE lands Day 7 of the plan).
- Revenue = hosted convenience (setup, uptime, billing) + Sponsors + one-time
  self-host install help. Metering exists to protect the *hosted* service
  (audio-minute fair use), not to gate self-host.

## Requirements

### Functional requirements (from §1+§3 of the spec)

- FR-1 **[scaffold]** Register/login via magic link (email) with a
  first-sign-in "Personal" workspace automatically provisioned (role: owner).
- FR-2 **[scaffold]** Google sign-in optional in deployments that configure it
  (env-gated; the button doesn't exist without credentials).
- FR-3 **[scaffold]** Health endpoint exposing real service state
  (`/healthz` on app and worker; storage/queue staged as not-provisioned).
- FR-4 **[planned, Days 4–6]** Upload or record a meeting (audio storage);
  worker transcribes it (local faster-whisper default; Groq as paid engine).
- FR-5 **[planned, Days 8–13]** LLM summaries + action items per meeting.
- FR-6 **[planned, Days 8–13]** Team dashboard: meetings list, transcript
  viewer, search, shareable meeting pages.
- FR-7 **[planned, Days 8–13]** Hosted billing (Paddle as merchant-of-record;
  Free 300 audio-min/mo, Pro 4 000/seat fair use; self-host unlimited).
- FR-8 **[planned, Day 7]** One-command self-host (`docker compose up`) with
  migrations auto-run.

### Non-functional requirements

- English-only v1 (spec decision §13).
- Postgres is the only infrastructure the core needs (audio storage gets
  S3-compatible storage; self-host maps to MinIO).
- Run budget: defaults sized for 2-core/4 GB boxes (worker concurrency 1;
  local small-int8 model).
- No meeting bots in-box: recording happens in-browser or via upload (spec
  decision; calendar auto-join is out of scope v1).

## User stories

- As a host, I run one compose file and get a working meeting-notes service
  I fully control.
- As a user, I sign in with only my email (magic link, no passwords) and
  immediately have my own workspace.
- As a user, I upload a meeting and get a transcript, summary, and action
  items without leaving the app.
- As a team owner, I see what compute my workspace consumed and pay only if
  I chose the hosted cloud.

## Acceptance criteria

- **Days 1–3 [delivered]** — `compose up` (db) → migrations → app up →
  register + login green on localhost; healthz truthful; worker scaffold
  answers `/healthz`. `scripts/smoke-auth.sh` proves the auth chain green.
- **Days 4–6 [planned]** — upload → queue job → worker transcribes locally →
  dashboard shows transcript (DoD includes a degraded-output filter).
- **Day 7 [planned]** — full self-host compose (web + worker + db + storage +
  proxy), LICENSE/TRADEMARKS land, README v0.
- Later milestones per spec §5 (billing week, polish, launch).

## Out of scope (v1)

English beyond v1, meeting bots/join-automation, mobile apps, multi-
workspace billing tiers beyond Free/Pro, RTMS/thread integrations beyond
sharing links — see spec §13 for locked decisions.
