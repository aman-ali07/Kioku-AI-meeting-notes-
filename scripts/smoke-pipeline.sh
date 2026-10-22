#!/usr/bin/env bash
# Kioku pipeline smoke — the Days 4–6 DoD gate: upload → queue → worker →
# transcript rows in Postgres.
#
# Flow: healthz → (reused auth flow, fresh email) → fixture download (an 11s
# public-domain speech clip — a tone would only prove the degenerate path) →
# authenticated upload → poll meetings.status until terminal → assert
# completed AND ≥1 transcript segment. A real worker is required for PASS —
# start it with: cd worker && uv run python pipeline.py
#
# Requires: dev server (SMOKE_LOG), compose db, worker process running.
# Usage: scripts/smoke-pipeline.sh [BASE_URL]
set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"
SMOKE_LOG="${SMOKE_LOG:-/tmp/opencode/kioku-dev.log}"
EMAIL="pipe-$(date +%H%M%S)@kioku.test"
JAR="$(mktemp /tmp/opencode/kioku-smoke-pipe-jar.XXXXXX)"
FIXTURE="/tmp/opencode/kioku-jfk.wav"
trap 'rm -f "$JAR"' EXIT

die() { echo "FAIL: $*" >&2; exit 1; }

curl -sf -m 10 -o /dev/null "$BASE_URL/healthz" || die "healthz unreachable"
echo "✓ healthz"

# --- Auth (same chain as smoke-auth.sh, self-contained) ---
csrf=$(curl -sf -m 15 -c "$JAR" "$BASE_URL/api/auth/csrf" \
  | python3 -c 'import sys, json; print(json.load(sys.stdin)["csrfToken"])') \
  || die "csrf fetch failed"
log_offset=$(stat -Lc %s "$SMOKE_LOG")
curl -sf -m 15 -b "$JAR" -X POST "$BASE_URL/api/auth/signin/email" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "csrfToken=$csrf" \
  --data-urlencode "email=$EMAIL" \
  --data-urlencode "callbackUrl=$BASE_URL/dashboard" \
  -o /dev/null || die "signin POST rejected"
magic=""
for _ in $(seq 1 15); do
  magic=$(tail -c "+$((log_offset + 1))" "$SMOKE_LOG" \
    | grep -F -A1 "Magic link for $EMAIL" | grep -om1 'http[^[:space:]]*' || true)
  [ -n "$magic" ] && break
  sleep 1
done
[ -n "$magic" ] || die "no fresh magic link"
curl -sf -m 15 -b "$JAR" -c "$JAR" -L "$magic" -o /dev/null || die "callback failed"
kuid=$(curl -sf -m 15 -b "$JAR" "$BASE_URL/api/auth/session" \
  | python3 -c 'import sys, json; print(json.load(sys.stdin).get("user", {}).get("id") or "")')
[ -n "$kuid" ] || die "no session uid"
echo "✓ authenticated ($kuid)"

# --- Speech fixture (public-domain JFK clip from whisper.cpp samples) ---
if [ ! -s "$FIXTURE" ]; then
  curl -sfL -m 60 -o "$FIXTURE" \
    https://github.com/ggml-org/whisper.cpp/raw/master/samples/jfk.wav \
    || die "fixture download failed (network?)"
fi
echo "✓ fixture ready ($(stat -Lc %s "$FIXTURE") bytes)"

# --- Upload through the real API ---
resp=$(curl -sf -m 60 -b "$JAR" -H 'Expect:' \
  -F "file=@$FIXTURE;type=audio/wav" -F "title=Pipeline smoke" \
  "$BASE_URL/api/upload") || die "upload rejected"
mid=$(echo "$resp" | python3 -c '
import json, sys
data = json.load(sys.stdin)
print(data["meetingId"])') || die "upload response unreadable: $resp"
[[ "$mid" =~ ^[0-9a-fA-F-]{36}$ ]] || die "not a meeting id: $mid"
echo "✓ uploaded (meeting $mid)"

# --- Poll for a terminal meeting state ---
first_status=""
for _ in $(seq 1 40); do  # 40 × 5s = 200s; small/int8 on 11s speech ≪ this
  status=$(docker compose exec -T db psql -U kioku -d kioku -tA \
    -c "SELECT status FROM meetings WHERE id = '$mid'") \
    || die "db unreachable during poll"
  [ -n "$first_status" ] || first_status="$status"
  case "$status" in
    completed|low_confidence|failed) break ;;
  esac
  sleep 5
done
if [ "$status" != "completed" ]; then
  die "meeting ended '$status' (first seen: $first_status); job state:
$(docker compose exec -T db psql -U kioku -d kioku -tA -c \
  "SELECT status, attempts, last_error FROM jobs WHERE payload->>'meetingId' = '$mid'")"
fi
echo "✓ meeting completed (first seen: $first_status)"

segments=$(docker compose exec -T db psql -U kioku -d kioku -tA \
  -c "SELECT count(*) FROM transcript_segments WHERE meeting_id = '$mid'") \
  || die "segment count query failed"
[ "$segments" -ge 1 ] || die "completed but 0 transcript segments"
echo "✓ transcript segments verified ($segments row(s))"

echo ""
echo "PASS — upload → queue → transcribe → transcript rows green (meeting: $mid)"
