#!/usr/bin/env bash
# Shared magic-link login for smoke scripts (console transport → session).
# Requires: die() defined by the caller, dev server up, SMOKE_LOG readable.
# Usage: source "$(dirname "$0")/lib/smoke-session.sh"
#        smoke_login "$BASE_URL" "$EMAIL" "$JAR" "$SMOKE_LOG"
#        uid="$SMOKE_UID"
# The jar is populated in place; the magic link must be written after the
# call starts, so stale links in the log are never accepted.

smoke_login() {
  local base_url="$1" email="$2" jar="$3" smoke_log="$4"
  local csrf magic log_offset session uid

  csrf=$(curl -sf -m 15 -c "$jar" "$base_url/api/auth/csrf" \
    | python3 -c 'import sys, json; print(json.load(sys.stdin)["csrfToken"])') \
    || die "csrf fetch failed"
  [ -n "$csrf" ] || die "csrf token empty"

  log_offset=$(stat -Lc %s "$smoke_log")
  curl -sf -m 15 -b "$jar" -X POST "$base_url/api/auth/signin/email" \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    --data-urlencode "csrfToken=$csrf" \
    --data-urlencode "email=$email" \
    --data-urlencode "callbackUrl=$base_url/dashboard" \
    -o /dev/null || die "signin POST rejected (non-2xx)"
  echo "✓ magic-link sign-in requested"

  magic=""
  for _ in $(seq 1 15); do
    magic=$(tail -c "+$((log_offset + 1))" "$smoke_log" \
      | grep -F -A1 "Magic link for $email" \
      | grep -om1 'http[^[:space:]]*' || true)
    [ -n "$magic" ] && break
    sleep 1
  done
  [ -n "$magic" ] || die "no magic link appeared in $smoke_log after offset $log_offset"
  echo "✓ fresh magic link captured"

  curl -sf -m 15 -b "$jar" -c "$jar" -L "$magic" -o /dev/null \
    || die "magic-link callback failed"
  echo "✓ callback followed"

  session=$(curl -sf -m 15 -b "$jar" "$base_url/api/auth/session") \
    || die "session endpoint failed"
  uid=$(echo "$session" | python3 -c 'import sys, json
d = json.load(sys.stdin)
uid = d.get("user", {}).get("id") or ""
print(uid)
sys.exit(0 if uid else 1)') \
    || die "session has no user.id: $session"
  [[ "$uid" =~ ^[0-9a-fA-F-]{36}$ ]] || die "session user.id not a uuid: $uid"
  echo "✓ session carries user.id ($uid)"

  SMOKE_UID="$uid"
}
