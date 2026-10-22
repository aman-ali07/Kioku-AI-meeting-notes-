# Kioku — Open-Source, Self-Hostable AI Meeting-Notes Platform
**Design & 30-day execution plan** · Draft v1.1 · 2026-10-22 · Status: **user-approved — all §13 decisions locked, ready for Build mode**

> Written for: solo developer, final-year B.Tech, AI-assisted ("vibe") coding, 2–4 h/day,
> infra budget < $40/mo, target stack TypeScript web + Python worker.
> All market numbers below were verified against vendor/pricing pages and repos on 2026-10-22 (see Evidence appendix). Prices drift; re-verify before launch posts.

---

## 0. TL;DR

Build **Kioku**: the complete "self-hosted Fireflies for teams" web product — upload or
in-browser-record a meeting → transcribe (local faster-whisper by default, cheap Groq/Whisper
API as fallback) → LLM summaries + action items → searchable team dashboard with shareable
meeting pages. Core is **100% free, fully self-hostable, unlimited** under AGPL-3.0; revenue
comes from a hosted cloud at **$6/user/mo (₹≈500)** for zero-setup convenience + billing, plus
GitHub Sponsors and one-time self-host concierge installs. Precedents verified: Plausible
bootstrapped to $1M ARR (Jun 2022) → ~$3.1M (late 2024) with exactly this model and zero paid ads.
**Server bill: $0–8/mo at launch (free Oracle A1 dev box — 2 OCPU/12 GB — or a €5 Netcup box; pico/nano cannot host the worker's ~1.5 GB), ≈€5–8/mo from the first paying card, and an adversarial worst case of ≤$40 in an all-free-tiers-fail month. Quantified promise: paying users get ≤5-min turn on a 1-h meeting (Groq turbo, $0.04/h ≈ $1/user/mo), free/self-host users get ≤45-min queue — identical accuracy at every tier.**

Day-30 success metrics: **≥25 self-host installs, ≥3 paying cloud users (honest 5–6% funnel math on ~50 activated), ≥200 GitHub stars, 1 pilot
cohort (student incubator/club).**

---

## 1. Intent & Why (verified market context)

**User intent:** build a credible open-source alternative to expensive per-seat meeting-notes SaaS,
earn $5–15/user/mo via a hosted cloud, without ever feature-gating the self-hostable core.

**Verified 2026 price anchors (commercial incumbents):**

| Product | Free tier pain | Paid per seat |
|---|---|---|
| Otter.ai | 300 min/mo, 30-min cap/conversation, 6 languages | Pro $16.99/mo ($8.33 annual), Business $30 |
| Fireflies.ai | 800 min free, meters, "AI credits" on top | Pro $10, Business $19, Ent. $39 |
| tl;dv | 40 recordings/wk, retention 3 mo | Pro $18, **Business $59/seat** (10-person team = $590/mo) |
| Fathom | Free unlimited *personal* | Teams $19 |

**Verified OSS state of the field (the gap):**

| OSS project | License (verified) | What it is | What it lacks |
|---|---|---|---|
| Meetily (Zackriya) | MIT core (community); commercial Pro separate | Local desktop note-taker (Win/macOS, Linux source build), Ollama + Whisper free | No server/team/web layer — cannot monetize as team cloud |
| Vexa | Apache-2.0 *brand*; **meeting-bot API server is Elastic License 2.0** (no offering it as a hosted service) | Developer bot/transcript API + MCP | Not an end-user product; license blocks hosted resale of *their* bot API |
| vexa-desktop | MIT OR Apache-2.0 (dual) | Granola-style local recorder | No team layer |
| OpenWhispr, akou, Nojoin, transcripted, TalkTrack | early-stage (verify licenses before use) | Local recorders / Granola-style DIY | Fragmented, no mature team product |

**Conclusion:** the "open-source meeting intelligence" slot is *late-but-fragmented at the infra layer*
(bots/diarization exist as repos, papers, and vendored services) and *early-mostly-empty at the product
layer*. Nobody yet ships the full product-shaped thing: consensual, privacy-first, transcription-local,
team dashboard, shareable pages, self-hostable in one command. That gap is buildable with vibe-coded
web-stack work (upload → chunk → transcribe → summarize → CRUD + dashboards), with the one hard part —
meeting bots — deliberately deferred to month 2, and with DIY feasibility already proven by public
bot repos (screenappai/meeting-bot 186★ TS+Playwright covering Meet/Teams/Zoom; h3xassist FastAPI+NextJS+WhisperX).

Community validation exists: r/selfhosted threads for Meetily and Vexa show recurring "finally a
self-hosted Fireflies/Otter" appetence — the target audience is already trained to look for this.

---

## 2. Goals / Non-goals / Anti-goals

**Goals (30-day horizon)**
- G1: Self-hostable core at parity with cloud: record/upload → transcript → AI summary + action items → dashboard → share links → search. One `docker compose up` from clean machine.
- G2: Nothing gated: same feature set self-hosted as hosted. Hosted sells *operation* (uptime, billing) not *capability*.
- G3: Zero-signup local demo; cloud free tier without a credit card.
- G4: Cost floor ≈ **$0–8/mo** at launch (a free/provisioned Oracle dev box at best; otherwise one €5–8 Netcup box) and ≤ **$55/mo all-in** at 500 activated users (infra + ASR + LLM + email). The moment a paying customer exists, hosted reliability and latency are bought from revenue — free tiers never face paying users.
- G5: AI-model agnostic: transcription engine and LLM provider pluggable per workspace (env + BYO keys), never a cloud dependency claim.

**Non-goals (explicitly out of 30 days)**
- Meeting bots auto-joining Meet/Teams/Zoom (month 2+; requires own clean-room bot—see R2)
- Calendar auth/auto-join, Slack/Teams digests, embeddings search, mobile apps, SSO/SAML/SAML-adjacent, multi-region, RLS multi-tenant isolation (single-tenant personal deployments v1; `?org=` tenancy within instance only)

**Anti-goals (would make this a failure even if it ships)**
- "Pro" flags or crippled features in the open repo; metered "AI credits" dark-pattern (a *verified* Fireflies complaint)
- Trapping data in the cloud: full markdown/JSON export + self-host migration path from day one
- Recording without consent UX; scraping or lifting incumbent vendor assets/UI
- Forking the repo from Cap.so/Vexa wholesale (AGPL hygiene: clean-room our own)

---

## 3. Constraints (decided up front)

- **Time:** 2–4 h/day final-year student; 2-week slices with buffer; exams can pause for a week.
- **Budget:** ≤$8/mo until first paid customer; ≤$55/mo all-in at 500 users; every stage has a cost-justified KPI; any host/provider swap must take ≤1 h (compose statelessness + nightly `pg_dump` → R2).
- **Stack discipline (vibe-coded):** boring, maximize-strength scaffolding — Next.js 15 (App Router, TypeScript), Drizzle ORM + Postgres 16, Auth.js (magic link + Google), Tailwind + shadcn/ui, Python 3.11 FastAPI worker, ffmpeg, faster-whisper (small, int8, batched) as bundled default engine; optional Groq/Whisper providers. **Queue** (chosen over Celery/Redis): Postgres-only job queue (`FOR UPDATE SKIP LOCKED`) — one moving part less.
- **License:** AGPL-3.0 + explicit TRADEMARKS.md + CONTRIBUTING house rules. Rationale: Plausible's MIT→AGPL move after clone-enforced copycats; AGPL protects the hosted plan without taking anything from users.
- **Recording/consent:** consent banner at record time; "I am authorized to record this meeting" click-through; per-meeting deletion controls; written row = the source of truth in meta. International two-party-consent & GDPR posture: consent before record; retention defaults (90d cloud free, forever self-host).

---

## 4. Approaches considered (trade-offs, pick)

| | A1 Desktop-first (Meetily shape) | A2 Closed hosted SaaS | **A3 Chosen: Web-first, AGPL core, hosted-led** | A4 Bot-first (Vexa shape) |
|---|---|---|---|---|
| Speed to product | fast, but no server story | | medium | slow (driver fleets, anti-bot, revisit month 2+) |
| Monetizable layer | weak (desktop pkg = not SaaS) | strong but violates free-core promise | strong (cloud ops, billing convenience) | API-level, needs enterprise infra |
| Audience fit for solo student | medium (tinkerers only) | | **broad: SMB teams + student clubs + agencies** | infra-bound, heavy support |
| Sharp edge for differentiation | low | n/a | **high: first complete team web product with local-first transcription** | medium |

A3 was chosen because it converts verified demand both ways: privacy-tinkerers (self-host) and
price-angered teams (cloud $6 vs Otter $16.99/tl;dv $59). Local transcription default is the actual
unfair advantage: *self-hosters get transcription compute-free*; cloud buyers get an unbeatable entry price.

---

## 5. Product definition (v0.1 → v1.0 scope)

### Core product features (in the open repo; 100% of them work self-hosted)
1. **Audio ingestion (2 paths):** (a) drag-drop upload mp3/wav/m4a/webm ≤1 GB; (b) in-browser MediaRecorder capture of mic + system audio (Chrome/Edge; "non-Playwright" path keeps v1 browser-simple).
2. **Transcription pipeline:** ffmpeg → ≤30 s chunks + faster-whisper built-in `vad_filter` *(builder default: no extra VAD dependency)* → engine runner → segments `{start_ms,end_ms,speaker_idx,text,confidence}` → editor UI (rename speakers, fix lines). Engines pluggable: `local-faster-whisper (small int8) — self-host & free-tier default` | `groq-turbo ($0.04/h — cloud paid default)` | `openai-whisper-1`. Optional seed: `whisperx` diarization (best-effort; speaker labels split/merge by hand first). **Summaries consume a degenerate-output filter** (repetition-score + confidence floor): noisy audio renders a "low-confidence pass" badge on the meeting rather than manufacturing garbage action items.
3. **AI summaries, per meeting:** TL;DR (≤120 words), Decisions[], Action items[{text, owner?, due?}], Open questions[], Key stats[]. LLM provider pluggable (OpenAI-mini-class / Groq / Gemini / Ollama via OpenAI-compatible base_url); **cost caps per workspace** + caching (same transcript ⇒ same summary served).
4. **Dashboard:** meetings list (filters: mine/shared, status transcription/summary failed/succeeded), global search (Postgres `tsvector` + `pg_trgm`; no vector DB in 30 days), usage & minutes meters, workspace members (owner/members/viewer RBAC-lite).
5. **Shareable meeting page:** signed public URL, optional expiry + passcode, markdown export, JSON export.
6. **Data governance:** retention policy (per workspace: 90d default on cloud free tier; ∞ self-host), hard delete with audio purge (S3/FS), activity log minimal (who/what/when for meetings).
7. **Self-host ship:** `docker-compose.yml` (web + worker + postgres + optional minio + caddy TLS) + `.env.example` + demo seed + `docker/migrations` auto-run; fresh-VM install check is a CI job (GitHub Actions runner → verify `compose up` → `curl /healthz`).
8. **BYO-LLM keys:** stored workspace-level, encrypted at rest (AES-GCM app secret), never logged; provider-agnostic.

### Cloud-only (still not feature-gating)
billing, seat counts, cloud storage slightly larger, email digests (month 2).

### Phase 2 (month 2+ design later, not built now): Google Meet bot (own clean-room Playwright bot; consent-gated), Google Calendar OAuth auto-invoke, Slack digest webhook, `articles`-style public knowledge pages.

---

## 6. Architecture

```
        ┌──────────────── Next.js 15 web (Vercel-compat container / self-host container) ────────────┐
        │  UI (App Router, RSC) · REST API v1 · Auth.js · share-link service · billing (Stripe webhook)│
        └──────────────┬──────────────────────┬──────────────────────────┬──────────────────────────┘
                       │                      │                          │
        object storage (LocalFS | S3/R2/MinIO)│       Postgres 16: business data + Job queue row
                       │                      │                          │
        ┌──────────────┴──────────── Python 3.11 FastAPI worker (self-host container) ─────────┐
            ffmpeg chunker → engine.local(faster-whisper small int8) or engine.groq →
            segmenter → optional diarization → LLM summarizer (pluggable providers) →
            writes segments/summary rows + status updates (poll 1s / LISTEN-NOTIFY optional)
        └──────────────────────────────────────────────────────────────────────────────────────┘
```

**Key calls to the builder (already decided; "minor" per Ousterhout-bar):** Postgres-only queue (no Redis); SSE for job progress; single-tenant-per-instance for self-host; app-layer tenancy inside an instance; Tailwind/shadcn; Drizzle migrations in-repo; health endpoints `/healthz` include engine + storage + db checks; every repo file route server-side validated. **[Builder defaults from the check, applied:]** worker runs **1 concurrent ASR job per instance** (2-vCPU box; **queue pop is plan-aware** — paid jobs first, mechanizing §9's priority promise), `jobs.locked_at` lease-TTL reclaims crashed jobs; infra = **one VPS for the whole stack** at launch, worker boxes added by the measured queue-wait trigger (Day 14 instrumentation) (web+worker+pg behind Caddy; Vercel = portability claim only); email = Brevo (300/day free) default, Resend (100/day free) alt, console-transport in dev, magic-link-first; audio capture order = mic-only first, `getDisplayMedia` tab-audio merge as labeled **beta**; summary cache key = `sha256(normalized transcript + prompt template + model)` with explicit force-regenerate flag; no fetch-by-URL ingestion source in v1; **cgroup CPU/IO caps + `nice`/`ionice` on the worker** so transcription never starves auth/SSR/PG.

## 7. Data model (Drizzle sketch)

`users, workspaces (incl. `retention_days`: cloud free 90, Pro/custom, self-host ∞ — builder default), workspace_members(ws_id, user_id, role), meetings(id, ws_id, title, status, source, audio_key, duration_ms, started_at, created_by), transcript_segments(meeting_id, idx, start_ms, end_ms, speaker_idx, text, confidence), summaries(meeting_id, kind, content_jsonb, model, cached), action_items(meeting_id, text, assignee_free_text, due_date), share_links(id, meeting_id, token_hash, expires_at, passcode_hash, revoked), api_keys(ws_id, provider, ciphertext, last4), jobs(id, kind, payload, status, attempts, locked_at ← lease-TTL so crashed jobs self-reclaim), usage_meters(ws_id, month, audio_minutes ← the one canonical meter, see §9), subscriptions(ws_id, plan, provider, external_id, status)

Migration policy: forward-only SQL, seed demo workspace in `compose`, rollback = redeploy previous tag (v1 data is disposable; money data handled at Stripe, not rebuilt by hand).

## 8. API sketch (REST v1, minimal)

- `POST /api/meetings` — create meeting (multipart upload | MediaRecorder blob); `source` column enum-ready *(builder default: no fetch-by-URL source in v1)*
- `GET /api/meetings?cursor=`, `GET /api/meetings/:id`, `PATCH /api/segments/:id`
- `POST /api/meetings/:id/summary` (idempotent regenerate), `GET /api/search?q=`
- `GET /api/share/:token` (public), `POST /api/share_links/:meetingId`
- `POST /api/stripe/webhook`, (month 2: `POST /api/bots: dispatch`)
- Rate-limits (cloud only): the §9 audio-minute meters per workspace + **1 concurrent transcription job per workspace**; queued beyond that. Self-host = unlimited, meters off (license purity).
- Ingest hardening: Cloudflare Turnstile on cloud signup, **per-IP upload caps (≤5/day)**, ffprobe magic-bytes + duration sanity (≤3 h) before queueing — kills cardless free-tier abuse before it fills the disk.

## 9. Licensing, monetization & precedent

**AGPL-3.0 core.** Add LICENSE, TRADEMARKS.md ("you may self-host and modify freely; you may not use our name/logo/docs to market a competing hosted service"), a minimal supported-building CONTRIBUTING, and an explicit disincentive to silent forks (upstream-first culture + marketing transparency).

**Pricing (verified competitor sanity anchors):**

| Tier | $ | ₹ | Includes |
|---|---|---|---|
| Open-source core | $0 | ₹0 | everything, unlimited, self-hosted |
| Cloud Free | $0 | ₹0 | 1 seat, **300 audio-min/mo** (≈5 one-hour meetings), 90-day retention — no card |
| Cloud Pro | **$6/user/mo** (annual) | ≈₹500→₹399/yr promos | **4,000 fair-use audio-min/seat/mo** (≈65 h; median usage is a small fraction), no retention cutoff, digests-lite; overage pauses new jobs with an upgrade banner — never surprise-bills |
| Cloud Team (flat ≤10 seats) | **$19/mo** | ≈₹1,600/mo | everything + priority (mechanized: plan-aware queue pop + turbo engine, §6) + support SLA-lite |
| Self-host concierge | $49 one-time | ₹4,000 | hands-on install call (30 min) |
| Patronage | GitHub Sponsors | — | no obligations |

**Canonical metering (single source of truth — supersedes any other number in this doc):** the cloud meters **transcribed audio-minutes per workspace per month** (`usage_meters.audio_minutes`, sum of `meetings.duration_ms`). Free = 300; Pro = 4,000/seat; jobs that would breach the cap are queued with a visible banner + one-click upgrade — no surprise bills, no feature gating. Self-host = meters don't exist. *(My call as proposed default — pending user confirmation, see §13; resolves the builder check's §8/§9/§12 contradiction.)*

Payments (**user-confirmed**, built test-mode Week 4): **Paddle-as-MoR from day one** — zero entity paperwork, merchant-of-record handles global tax (KYC-lite for an individual student), fees ≈ 5% + payment processing. Checkout is always provider-hosted (no custom billing UI). *(Stripe Atlas — US C-corp, ~$350 — is NOT the Indian solo-founder path; old note retired.)*

**Precedent stamped (Plausible; AGPL, bootstrapped, zero ad spend):** 324 days → $400 MRR; 9 months → $10k MRR; **$1M ARR Jun 2022**; ~**$3.1M ARR late 2024**; 7k–15k paying subs. Their model = the *same code* self-hosted or cloud, priced by cost driver. No reason our funnel should differ in kind.

---

## 10. Cost model & unit economics (verified figures)

**Minimum-cost infra ladder (verified Oct 2026; no k8s, ever):**
- **Build/dev box (≈$0–5/mo):** Oracle **Always Free ARM — halved on Jun 15, 2026 to 2 OCPU/12 GB** (enforced Aug 18, 2026; PAYG accounts still get 4 OCPU/24 GB at $0 but require a card); provisioning is capacity-limited and idle instances get reclaimed after 7 idle days → treat as *best-effort dev only*, never production. Netcup fallback: **VPS pico €1.85/mo** (1 vCPU/1 GB) or **nano €3.10/mo** (2/2 GB).
- **Production hosted cloud (the moment the first card is charged):** **Netcup VPS 500 G12.5 ≈ €5.90–7.98/mo** (2 vCPU / 4 GB ECC RAM / NVMe) — cheaper than post-repricing Hetzner CX22 (€8.99–10.99) while carrying the same stack; second €3–5 box joins only when transcription queue wait >15 min.
- Storage: **Cloudflare R2**: 10 GB free incl. egress free; then ~$0.015/GB-mo (hedge if pricing changes; audio-only keeps this tiny: 1 h ≈ 10–20 MB mp3).
- Domain ~$10–12/yr (Cloudflare Registrar ≈$1/mo amortized); email: **Resend free = 3,000/mo (100/day)** or **Brevo free = 300/day** — magic-link volume at launch is a few per day; paid email only past ~10k contacts.

**Transcription math (the load-bearing claim):**
- **Local (canonical worker model — this paragraph supersedes the earlier inconsistent one):** faster-whisper small-int8, batched, on a 2-shared-vCPU box ⇒ **RTF ≈ 0.25–0.5** (1-h audio in ~15–30 min CPU; batch=8 degrades gracefully on few cores); dedicated-core boxes do better. Effective cloud capacity ≈ **700–1,000 audio-h/mo per dedicated 2-core box** after web/pg/upload contention. Traction-stage volume (~1,500–2,000 audio-h/mo at 500 activated ⇒ ~2,000–2,400 worker-h) ⇒ **2 dedicated worker boxes**, each a €5–8 decision gated on the *measured* queue-wait metric (instrumented Day 14), never on gut feel. GPU never required in v1.
- **API (paid and priority — the no-compromise path):** **Groq `whisper-large-v3-turbo` = $0.04/audio-hour** is the **cloud paid-tier default engine** (payers get ≤5-min turn; ≈$1/user/mo — cheaper than one day of the Team plan); `whisper-large-v3` = $0.111/h for accuracy-critical jobs; OpenAI whisper-1 = $0.36/h (rare fallback). Groq's *free* ASR tier (20 RPM, 2,000 req/day ⇒ only ~16 free audio-h/day, with ≈6-min chunk pacing per 1-h meeting) is explicitly **launch trickle, not a UX path** — the stage table assumes paid turbo for payers and local queue for free users. Cost-capped per workspace + BYO-key option = fraud-proof.

**LLM summaries:** 1 h transcript ≈ 15k tokens; summary pipeline ≈ ~20k tokens in+out; mini-class paid pricing ⇒ **≈ $0.35–2 per 1,000 summarized hours** — pennies, priced into the stage table. ⚠ 2026 free-tier reality: Gemini API ≈20 req/day; **Groq free *text* token caps (8K TPM / 200K TPD) bind before request caps ⇒ ≈10 large summaries/day** — so the $0 path is **OpenRouter `:free` models after a one-time $10 credit (unlocks 1,000/day; roster churns monthly)** for the launch trickle, with paid mini-class taking over the moment volume exists. Cached summaries (§6) cap spend; BYO keys keep self-hosters at $0 forever.

| Stage | Activated users | Infra $/mo | ASR+LLM $/mo | Revenue (funnel 5–8% cloud act, 5–6% paid @ $6) | Margin |
|---|---|---|---|---|---|
| Launch (d30) | ~50 | **$0–8** ($0 if an Oracle A1 dev box provisions; else Netcup **VPS 500/Lite 1** — pico/nano cannot host the worker) | **$3–8** (OpenRouter $10 one-time buffer + pennies of paid-LLM trickle) | $0–30 | negative-but-fine |
| Traction | ~500 | **$25–35** (1 web + 2 dedicated worker boxes + R2 spill; each box added on the measured queue-wait metric) | **$12–20** (Groq turbo priority for payers ≈$1/mo each; free users on local queue + cached mini-model) | **$150–215** | 3–5× |
| Scale | ~5,000 | $150–280 (web 2×; ~7 dedicated-core workers; pg backups) | $80–140 (local primary + turbo overflow; caching holds) | **$1,500–3,500** | 4–7× |

Funnel assumptions stated for future correction; the *unit* economics (ASR ≤ $0.04/h; LLM ≈ 2c/h) are the durable facts.

**No-UX-compromise rule (explicit, priced into the plan):** every workspace — Free or paid — gets the identical transcription accuracy and summarizer models; meters throttle *quantity*, never *quality*. Anything paying users touch (uptime, backups, support latency) is never carried on free tiers: the first charged card triggers the €5–8/mo production box the same week. No ads, no telemetry-for-credits, no pay-to-view-your-own-data, no degraded "lite" models.
**Quantified experience promise:** paid ⇒ **≤5-min turn** on a 1-h meeting (Groq-turbo engine default; ≈$0.04/h ⇒ ≈$1/user/mo); free & self-host ⇒ **≤45-min turn**; identical accuracy everywhere. The latency difference is a *queue line*, not a model downgrade.
**Adversarial worst-case ledger (cross-checked):** if the dev box is reclaimed, launch-week spikes trip the email wall, and every AI free cap is exhausted simultaneously, launch month still binds at **≤ ~$40 all-in** (€7.98 production box + €4.92 worker + $20 email + <$2.50 paid ASR/LLM overflow + R2/domain) against 2–3 paying users — painful, survivable, never debt-financed, never user-hostile. The more likely reality is the first column of the table above.
**Honest rug-pull note:** the free tiers above (Oracle's halving, Gemini's slashing, OpenRouter's churning roster) are launch shaving on a design that runs on any €5 VPS — never load-bearing.

---

## 11. 30-day execution plan (vibe-coded, PR-gated)

Rules for the Build agent (to be enacted in Build mode):
- Ship in PRs ≤ ~800 LoC; human reviews each merge; tests red→green for: chunk math, permission checks, cost caps, share-token validation. Frontend needs no staged test suite; must pass `pnpm build` + `compose up` + `healthz` green.
- Every third-party package: verify exists + license before import (budget ~5 min/pkg). No `catch {}` swallows on billing/storage/auth paths — typed errors + surface a user action.
- No abstraction scaffolding until second concrete caller exists (Postgres-queue → engine/local stays concrete until groq engine actually written).

| Window | Milestone (PR-gated) | Definition of done |
|---|---|---|
| **Days 1–3** | Repo: pnpm monorepo (`/app`, `/worker`); Next.js 15 scaffold; Drizzle + migrations; Auth.js magic+Google; `docker-compose.yml`; `/healthz` | `compose up` → register + login green on localhost **and on the dev box** (Netcup pico/nano or free Oracle A1 — same compose file, zero laptop-only state) |
| **Days 4–6** | Upload → ffmpeg → job row → worker local-faster-whisper → segments table → transcript editor UI; LocalFS storage adapter | 1-h mp3 fully transcribed on same host (<45 min gate on 2 shared vCPU, <35 min stretch target); segments editable; speaker rename |
| **Day 7** | R2/MinIO adapter + share links + markdown/JSON export + landing page skeleton + README v0 + AGPL LICENSE + demo GIF workflow | v0.1.0 tag |
| **Days 8–10** | MediaRecorder capture; consent modal; workspace members + roles + workspace switcher; search via FTS | v0.2.0 tag |
| **Days 11–13** | Summaries: provider abstraction, prompt templates TL;DR/decisions/actions/open-questions/stats; cost caps + monthly meters + BYO keys v1; status fallbacks | 5-meeting demo instant; cap blocks 429 |
| **Day 14** | Retention job; WebDAV? NO — audio keys & DB.cleanup; `docs/` install & self-host guide (screenshotted fresh-VM install); **uptime monitors** (UptimeRobot + healthchecks.io dead-man switch, free) + **queue-wait metric wired to the box-scale trigger** | fresh Debian VM install verified for record (the marketing asset); dashboards green |
| **Days 15–17** | Pricing page + **Paddle checkout (confirmed choice)** test→live + webhook; Sponsor button; onboarding email (free tier); usage UI | first *test-mode* paid cloud user (test card 4242) |
| **Days 18–20** | r/selfhosted + Show HN + X-thread launch assets, blog post, PH kit staged; demo GIF v2 (10 s); Analytics (self-host = none; cloud = counts only); **all launch assets (demo transcript, GIF, seeded share pages) served from R2/CF-cache — the origin box is never in the blast radius of launch-day traffic**; email wall plan: Brevo 300/day default + Resend paid ($20) as day-1 failover if magic links wall | beta list v1 with 250-word onboarding email |
| **Days 21–24** | Bugbash with 10 real users (5 student clubs; 5 SMB/friends); telemetry counts; fix desk | bug list triaged; top-10 fixed |
| **Days 25–27** | Razorpay optional (if ≥15 Indian-email signups); docs polish; CONTRIBUTING; roadmap.md public | v0.9.0 tag |
| **Days 28–30** | Launch: PH Tuesday + r/selfhosted + Show HN + X thread + college/incubator sprinkle — all as one wave; **v1.0.0** | day-30 metrics: ≥25 installs, ≥5 paying, ≥200⭐, 1 pilot cohort live |

**Launch channels (concrete):** r/selfhosted (5-repo rules: selftext w/ demo GIF, docker one-liner, private-data stance, weekly replies), Show HN (Tue 08:00 ET), PH (Tue 00:01 PT, "launch w/ Huntmaker-ready asset"), X (r/LocalLLaMA angle thread), Indian student groups, Discord-forum → GitHub Discussions only.

---

## 12. Risks (ranked by what actually kills a solo dev)

| # | Risk | Probability | Impact | Mitigation |
|---|---|---|---|---|
| R1 | ASR cost blow-up on hosted cloud (a few heavy users swallow the margin) | M | H | canonical §9 meters: Free 300 audio-min/mo, Pro 4,000/seat fair-use; jobs pause + banner on cap; cached summaries; BYO-key incentive; local-first cloud worker (ASR mostly local ⇒ near-zero marginal cost) |
| R2 | Google/Teams anti-bot & ToS on Playwright auto-joining (month-2 bot) | M | H | bots are phase-2; consent-gated; gentle rate limits; read each platform's ToS; user-invoked/manual-flow fallback; explicit opt-out; no "stealth" claims |
| R3 | Vibe-code drift: PROD ошибки, auth/billing holes, "AI sloped" abstractions | **H** | H | PR size caps + human review + red-green tests on the 4 money/privacy paths + SCA scan (import budget) + nightly compose smoke test |
| R4 | Storage/processing bloat | M | M | audio-only favoritism v1, retention job, per-workspace disk warn |
| R5 | Payments in India (Razorpay KYC as an individual) | M | L for 30d | start Stripe; Razorpay week-2 post demand spike; Paddle MoR as fallback (higher %) |
| R6 | Clone-roadmap risk: copycats | M | M | AGPL + TRADEMARKS + upstream-first + transparent public roadmap |
| R7 | Academic calendar crunch | H | M | 2-week slices + explicit "pause rules"; ship even 20% slices of PR lists; no vapour |
| R8 | Free-tier rug-pulls — Oracle halved Always Free ARM (Jun 15, 2026, enforced Aug 18), Gemini API free ≈20 req/day, OpenRouter `:free` roster churns | **H (confirmed 2026 trend)** | M (launch phase only) | Design rule: free tiers only shave launch cost on a plan that runs on any €5 VPS; BYO-provider config + nightly `pg_dump` → R2 + compose statelessness ⇒ host/provider swap ≤1 h; paid reliability bought from revenue week 1 |

**Honest residual unknowns:** diarization quality (pyannote on 2 vCPU; may ship "speaker 1/2" manual split instead); in-tab system-audio capture via MediaRecorder needs Chromium `getDisplayMedia` workarounds (labeled beta); Stripe India as individual (Stripe Atlas ~$350 — defer unless needed).

---

## 13. Questions still needing the user (the "theirs" pile)

1. **Name — DECIDED:** **Kioku** (Japanese: "memory" — user-picked 2026-10-22 from the verified finalist set). Adjacent collisions are non-category only (a task-tracker app, a language-learning app, kioku.se training platform; kioku.ai sits on a for-sale listing, buyable later at traction). Pre-README checklist: register the GitHub org, an npm scope (`@kioku/*`), and `getkioku.com` / `kioku.so`; tagline for the kit: *"Your meetings, remembered."* (Prior working name *Kioku* is retired everywhere in this file.)
2. **Payments path — DECIDED:** **Paddle-as-MoR from day one** (user-confirmed; no entity paperwork, MoR handles global tax, ~5%+ fees). Alternatives kept on file, not built: Stripe + free Udyam proprietorship if fees must drop; Razorpay/UPI when Indian demand shows. Checkout stays provider-hosted.
3. **Metering — CONFIRMED:** audio-minutes; Free **300/mo** (≈5 hourly meetings), Pro **4,000/seat/mo fair use** (§9); self-host unlimited, meters off.
4. **Summary language — CONFIRMED:** English-only v1 (every unshipped prompt variant is an unshipped failure mode); Hindi/Hinglish revisited post-launch if demand shows.

## 14. What's deliberately left to the builder (= implement-me in Build mode)

- Final component/UI design details (visual language within shadcn defaults)
- Exact engine/prompt-tuning parameters per provider, held in a per-provider `prompts.ts` file (not a config layer)
- The day-by-day **task list** derived from §11 (I'll generate this before coding starts),
which is what Build mode consumes.

## 15. Evidence appendix (verification, 2026-10-22)

- Groq ASR: whisper-large-v3 **$0.111/h**; v3-turbo **$0.04/h**; free ASR tier 20 RPM / 2,000 req/day (≈16 free audio-h/day); free **text** tier token caps (8K TPM / 200K TPD on gpt-oss-120b-class ⇒ ≈10 large summaries/day — token caps bind before request caps) (console.groq.com/docs/speech-to-text, /rate-limits & model pages + 2026 pricing roundups: eesel.ai / cloudzero.com).
- faster-whisper benchmarks: SYSTRAN/faster-whisper repo README (small-int8 CPU 1m42s vs 6m58s openai/whisper; batched 14.6× CPU per Mobius Labs blog; **~1.5 GB RAM while loaded ⇒ 1–2 GB boxes cannot host the worker**). Parakeet TDT v3 CPU RTF < 0.1× (Northflank & snailtext benchmarks).
- Hetzner: June-2026 repricing note (docs.hetzner.com + northflank blog); CX22 historically €3.79 (vpsbenchmarks), current cost-optimized CX-class €8.99–10.99 range.
- Competitors: Otter $16.99/8.33-annual, Bus $30; Fireflies Free 800 min, Pro $10, Ent $39; tl;dv Pro $18, Bus $59/seat, free-tier heavy; **Fathom free unlimited personal, Teams $19** (vendor + G2 + fabric.so + fireflies.ai's own comparison page).
- OSS: Meetily MIT (github.com/Zackriya-Solutions/meetily); Vexa Apache-2.0 brand with script API = **Elastic License 2.0** and vexa-desktop dual MIT/Apache (github.com/Vexa-ai/*); screenappai/meeting-bot TS+Playwright 186★; h3xassist FastAPI/NextJS/WhisperX/Playwright; Nojoin/akou/transcripted/TalkTrack early (github topics: meeting-recorder google-meet).
- Zapier/n8n/Retool/Loom context (why NOT those categories): verified Oct 2026 in prior report — Zapier Pro $19.99→; n8n fair-code $24/$60 cloud; Retool $50+15; Loom $18/$24. Category rejection rationale stands on those anchors.
- Plausible precedent: plausible.io/blog (open-source-saas: $1M ARR Jun 2022; bootstrapping-saas: 324 days → $400 MRR); ~$3.1M ARR late-2024 (tinyempires profile); pricing-by-cost-not-features; zero paid ads.
- Minimum-cost stack (Oct 2026): Oracle Always Free **halved Jun 15, 2026** to 2 OCPU/12 GB, enforced Aug 18; PAYG accounts still get 4 OCPU/24 GB at $0 (docs.oracle.com; InfoQ Jul 3, 2026; HN thread) + community reports on capacity limits/7-day idle reclamation. Netcup: VPS pico **€1.85**, nano **€3.10**, Lite 1 **€4.92**, **VPS 500 G12.5 €5.90–7.98** (netcup.com; netcup.cheap; 2026 G12.5 price-hike table) — under Hetzner CX post-repricing. Gemini API free tier ≈**20 req/day** after 2026 slashes (ai.google.dev + community reports). Groq free text tier 30 RPM / 1,000 req/day (console.groq.com/docs/rate-limits). OpenRouter `:free` 50 req/day → 1,000 req/day after one-time $10 credits (openrouter.ai docs/FAQ). Email: Resend 3,000/mo (100/day); Brevo 300/day free (resend.com; Brevo help center).

*(Note: this file lives in `/home/aman/.opencode/plan/steno-plan.md` because plan mode only writes there — the filename keeps the old working name. Copy into the repo as `docs/specs/2026-10-22-kioku-design.md` when Build mode starts.)*
