#!/usr/bin/env bash
# Kioku self-host smoke — the Day-7 gate: the full compose stack
# (proxy → web, worker, db, storage volume) registers a user end-to-end,
# transcribes an upload and exports the zip, all through Caddy.
#
# Self-contained on purpose (like the other gates): it runs against the
# COMPOSE stack, reads magic links from `compose logs web` (console
# transport inside the container) and queries the selfhost postgres —
# dev-gate assumptions (SMOKE_LOG, :5433) never mix with this one.
#
# Usage: scripts/smoke-selfhost.sh [BASE_URL]
# Prereq: docker compose -f docker-compose.selfhost.yml up -d --build
#   (with the repo-root .env, or SELFHOST_ENV_FILE=<path> to match your up)
set -euo pipefail

BASE_URL="${1:-http://localhost:8080}"
EMAIL="self-$(date +%H%M%S)@kioku.test"
FIXTURE="/tmp/opencode/kioku-jfk.wav"
JAR="$(mktemp /tmp/opencode/kioku-smoke-selfhost-jar.XXXXXX)"
trap 'rm -f "$JAR"' EXIT

# The stack's env vars are :?-required, so EVERY compose invocation needs the
# same --env-file the stack was brought up with. Default: the documented
# repo-root .env (compose reads it itself); set SELFHOST_ENV_FILE to override.
ENV_FLAG=()
[ -n "${SELFHOST_ENV_FILE:-}" ] && ENV_FLAG=(--env-file "$SELFHOST_ENV_FILE")
compose() { docker compose -f docker-compose.selfhost.yml "${ENV_FLAG[@]}" "$@"; }
die() { echo "FAIL: $*" >&2; exit 1; }

curl -sf -m 15 -o /dev/null "$BASE_URL/healthz" \
  || die "proxy→web unreachable at $BASE_URL (stack up?)"
echo "✓ proxy → web healthz"

# --- Auth: fresh registration, magic link from the web container's stdout ---
csrf=$(curl -sf -m 15 -c "$JAR" "$BASE_URL/api/auth/csrf" \
  | python3 -c 'import sys, json; print(json.load(sys.stdin)["csrfToken"])') \
  || die "csrf fetch failed"
curl -sf -m 15 -b "$JAR" -X POST "$BASE_URL/api/auth/signin/email" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "csrfToken=$csrf" \
  --data-urlencode "email=$EMAIL" \
  --data-urlencode "callbackUrl=$BASE_URL/dashboard" \
  -o /dev/null || die "signin POST rejected"
magic=""
for _ in $(seq 1 30); do
  magic=$(compose logs web 2>/dev/null \
    | grep -F -A1 "Magic link for $EMAIL" | grep -om1 'http[^[:space:]]*' || true)
  [ -n "$magic" ] && break
  sleep 1
done
[ -n "$magic" ] || die "magic link never appeared in web container logs"
curl -sf -m 15 -b "$JAR" -c "$JAR" -L "$magic" -o /dev/null || die "callback failed"
kuid=$(curl -sf -m 15 -b "$JAR" "$BASE_URL/api/auth/session" \
  | python3 -c 'import sys, json; print(json.load(sys.stdin).get("user", {}).get("id") or "")')
[ -n "$kuid" ] || die "no session uid"
echo "✓ registered+signed in ($kuid)"

# --- Fixture ---
if [ ! -s "$FIXTURE" ]; then
  curl -sfL -m 60 -o "$FIXTURE" \
    https://github.com/ggml-org/whisper.cpp/raw/master/samples/jfk.wav \
    || die "fixture download failed"
fi
echo "✓ fixture ready ($(stat -Lc %s "$FIXTURE") bytes)"

# --- Upload through the proxy ---
resp=$(curl -sf -m 60 -b "$JAR" -H 'Expect:' \
  -F "file=@$FIXTURE;type=audio/wav" -F "title=Selfhost smoke" \
  "$BASE_URL/api/upload") || die "upload rejected"
mid=$(echo "$resp" | python3 -c '
import json, sys
print(json.load(sys.stdin)["meetingId"])') || die "upload response unreadable: $resp"
[[ "$mid" =~ ^[0-9a-fA-F-]{36}$ ]] || die "not a meeting id: $mid"
echo "✓ uploaded (meeting $mid)"

# --- Poll for terminal state (cold container: model download can take minutes) ---
first_status=""
for _ in $(seq 1 60); do
  status=$(compose exec -T db psql -U kioku -d kioku -tA \
    -c "SELECT status FROM meetings WHERE id = '$mid'") \
    || die "db unreachable during poll"
  [ -n "$first_status" ] || first_status="$status"
  case "$status" in
    completed|low_confidence|failed) break ;;
  esac
  sleep 10
done
[ "$status" = "completed" ] \
  || die "meeting ended '$status' (first seen: $first_status); job state:
$(compose exec -T db psql -U kioku -d kioku -tA -c \
  "SELECT status, attempts, last_error FROM jobs WHERE payload->>'meetingId' = '$mid'")"
echo "✓ meeting completed (first seen: $first_status)"

segments=$(compose exec -T db psql -U kioku -d kioku -tA \
  -c "SELECT count(*) FROM transcript_segments WHERE meeting_id = '$mid'") \
  || die "segment count query failed"
[ "$segments" -ge 1 ] || die "completed but 0 transcript segments"

# --- Full export through the proxy ---
curl -sf -m 60 -b "$JAR" -o /tmp/opencode/selfhost-export.zip \
  "$BASE_URL/api/meetings/$mid/export" || die "export failed"
python3 -m zipfile -t /tmp/opencode/selfhost-export.zip \
  || die "export zip failed validation"
echo "✓ export zip valid ($segments segment(s))"

echo ""
echo "PASS — proxy→web→db→worker→export green on the compose stack (meeting: $mid)"
