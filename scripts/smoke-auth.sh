#!/usr/bin/env bash
# Kioku auth smoke — the Days 1–3 DoD gate: register + login green on localhost.
# Flow: healthz → providers → csrf → magic-link sign-in (console transport) →
# callback → session(user.id) → dashboard 200 → **tenant rows in Postgres**.
#
# The DB assertion is the point: provisioning is what later milestones build
# on, and a dashboard-200 alone can hide a no-op (see TESTING.md).
#
# Requires: the dev server (`pnpm dev`) with its log at SMOKE_LOG, and the
# compose db running. Never delete that log file while the server holds its
# fd — truncate instead: `truncate -s 0 "$SMOKE_LOG"` (this script only reads
# bytes past a captured offset, so stale links from earlier runs are ignored).
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

# Every request uses -f so non-2xx fails here, not three steps later.
health=$(curl -sf -m 10 -o /dev/null -w '%{http_code}' "$BASE_URL/healthz") \
  || die "healthz unreachable (is the dev server up?)"
[ "$health" = "200" ] || die "healthz $health"
echo "✓ healthz 200"

providers=$(curl -sf -m 15 "$BASE_URL/api/auth/providers") \
  || die "providers endpoint failed"
echo "$providers" | grep -q '"email"' || die "email provider not advertised: $providers"
echo "✓ email provider advertised"

csrf=$(curl -sf -m 15 -c "$JAR" "$BASE_URL/api/auth/csrf" \
  | python3 -c 'import sys, json; print(json.load(sys.stdin)["csrfToken"])') \
  || die "csrf fetch failed"
[ -n "$csrf" ] || die "csrf token empty"

# Capture where the log ends its "past"; the magic link we accept must be
# written after this byte — links from previous runs are stale by definition.
log_offset=$(stat -Lc %s "$SMOKE_LOG")

curl -sf -m 15 -b "$JAR" -X POST "$BASE_URL/api/auth/signin/email" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "csrfToken=$csrf" \
  --data-urlencode "email=$EMAIL" \
  --data-urlencode "callbackUrl=$BASE_URL/dashboard" \
  -o /dev/null || die "signin POST rejected (non-2xx)"
echo "✓ magic-link sign-in requested"

magic=""
for _ in $(seq 1 15); do
  magic=$(tail -c "+$((log_offset + 1))" "$SMOKE_LOG" \
    | grep -F -A1 "Magic link for $EMAIL" \
    | grep -om1 'http[^[:space:]]*')
  [ -n "$magic" ] && break
  sleep 1
done
[ -n "$magic" ] || die "no magic link appeared in $SMOKE_LOG after offset $log_offset"
echo "✓ fresh magic link captured"

curl -sf -m 15 -b "$JAR" -c "$JAR" -L "$magic" -o /dev/null \
  || die "magic-link callback failed"
echo "✓ callback followed"

session=$(curl -sf -m 15 -b "$JAR" "$BASE_URL/api/auth/session") \
  || die "session endpoint failed"
uid=$(echo "$session" | python3 -c 'import sys, json
d = json.load(sys.stdin)
uid = d.get("user", {}).get("id") or ""
print(uid)
sys.exit(0 if uid else 1)') \
  || die "session has no user.id: $session"
[[ "$uid" =~ ^[0-9a-fA-F-]{36}$ ]] || die "session user.id not a uuid: $uid"
echo "✓ session carries user.id ($uid)"

code=$(curl -sf -m 15 -o /dev/null -b "$JAR" -w '%{http_code}' "$BASE_URL/dashboard") \
  || die "dashboard request failed"
[ "$code" = "200" ] || die "dashboard $code"
echo "✓ dashboard 200"

# --- The claim this script binds: the session's user owns an owner membership
# --- in a workspace, provable in the DB (not just rendered on the page).
tenant=$(docker compose exec -T db psql -U kioku -d kioku -tA \
  -c "SELECT count(*) FROM workspace_members um
      JOIN workspaces w ON w.id = um.workspace_id
      WHERE um.user_id = '$uid' AND um.role = 'owner'") \
  || die "db not reachable for tenant check (docker compose up -d?)"
[ "$tenant" -ge 1 ] || die "no owner membership row for $uid — provisioning failed"
echo "✓ tenant row verified (workspaces × owner membership)"

echo ""
echo "PASS — register + login green end to end (email: $EMAIL, uid: $uid)"
