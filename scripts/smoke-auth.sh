#!/usr/bin/env bash
# Kioku auth smoke — the Days 1–3 DoD gate: register + login green on localhost.
# Flow: healthz → providers → csrf → magic-link sign-in (console transport) →
# callback → session(user.id) → dashboard 200.
#
# Requires the dev server (`pnpm dev`) with its log written to the file given
# by SMOKE_LOG. Never delete that log file while the server holds its fd —
# truncate it instead: `truncate -s 0 "$SMOKE_LOG"`.
#
# Usage: scripts/smoke-auth.sh [EMAIL] [BASE_URL]
#   SMOKE_LOG=/tmp/opencode/kioku-dev.log scripts/smoke-auth.sh
set -euo pipefail

EMAIL="${1:-aman@kioku.test}"
BASE_URL="${2:-http://localhost:3000}"
SMOKE_LOG="${SMOKE_LOG:-/tmp/opencode/kioku-dev.log}"
JAR="$(mktemp /tmp/opencode/kioku-smoke-jar.XXXXXX)"
trap 'rm -f "$JAR"' EXIT

die() { echo "FAIL: $*" >&2; exit 1; }

health=$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$BASE_URL/healthz")
[ "$health" = "200" ] || die "healthz $health (is the dev server up?)"
echo "✓ healthz 200"

providers=$(curl -s -m 15 "$BASE_URL/api/auth/providers")
echo "$providers" | grep -q '"email"' || die "email provider not advertised: $providers"
echo "✓ email provider advertised"

csrf=$(curl -s -m 15 -c "$JAR" "$BASE_URL/api/auth/csrf" \
  | python3 -c 'import sys, json; print(json.load(sys.stdin)["csrfToken"])')
[ -n "$csrf" ] || die "csrf fetch failed"

curl -s -m 15 -b "$JAR" -X POST "$BASE_URL/api/auth/signin/email" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d "csrfToken=$csrf&email=$EMAIL&callbackUrl=$BASE_URL/dashboard" \
  -o /dev/null || die "signin POST failed"
echo "✓ magic-link sign-in requested"

magic=""
for _ in $(seq 1 15); do
  magic=$(grep -A1 "Magic link for $EMAIL" "$SMOKE_LOG" | grep -om1 'http[^[:space:]]*')
  [ -n "$magic" ] && break
  sleep 1
done
[ -n "$magic" ] || die "no magic link logged to $SMOKE_LOG"
echo "✓ magic link captured"

curl -s -m 15 -b "$JAR" -c "$JAR" -L "$magic" -o /dev/null \
  || die "magic-link callback failed"
echo "✓ callback followed"

session=$(curl -s -m 15 -b "$JAR" "$BASE_URL/api/auth/session")
echo "$session" | python3 -c 'import sys, json
d = json.load(sys.stdin)
sys.exit(0 if d.get("user", {}).get("id") else 1)' \
  || die "session has no user.id: $session"
echo "✓ session carries user.id"

code=$(curl -s -m 15 -o /dev/null -b "$JAR" -w '%{http_code}' "$BASE_URL/dashboard")
[ "$code" = "200" ] || die "dashboard $code"
echo "✓ dashboard 200"

echo ""
echo "PASS — register + login green end to end (email: $EMAIL)"
