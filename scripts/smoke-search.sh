#!/usr/bin/env bash
# Kioku search smoke — the Days 8–10 FTS gate.
# Flow: healthz → login → seed known meetings/segments for the caller's
# tenant AND a foreign tenant via psql → /api/search positives (title,
# transcript, one row per meeting) → cross-tenant miss → 401/empty/short/
# oversized boundaries → cleanup.
#
# Requires: dev server (`pnpm dev`, SMOKE_LOG) and the compose db.
# Usage: scripts/smoke-search.sh [BASE_URL]
#   SMOKE_LOG=/tmp/opencode/kioku-dev.log scripts/smoke-search.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/smoke-session.sh"

BASE_URL="${1:-http://localhost:3000}"
SMOKE_LOG="${SMOKE_LOG:-/tmp/opencode/kioku-dev.log}"
EMAIL="search-$(date +%H%M%S)@kioku.test"
JAR="$(mktemp /tmp/opencode/kioku-smoke-search-jar.XXXXXX)"
TOKEN="zqxsearch$(date +%s)$$"
FOREIGN="zqxforeign$(date +%s)$$"
MEETING_A=""
WS_B=""

die() { echo "FAIL: $*" >&2; exit 1; }

psql_t() { docker compose exec -T db psql -U kioku -d kioku -tAq -c "$1"; }

cleanup() {
  if [ -n "$MEETING_A" ]; then
    psql_t "DELETE FROM meetings WHERE id = '$MEETING_A'" >/dev/null 2>&1 || true
  fi
  if [ -n "$WS_B" ]; then
    psql_t "DELETE FROM workspaces WHERE id = '$WS_B'" >/dev/null 2>&1 || true
  fi
  rm -f "$JAR"
}
trap cleanup EXIT

search_json() {
  curl -sf -m 15 -b "$JAR" -G "$BASE_URL/api/search" --data-urlencode "q=$1"
}

curl -sf -m 10 -o /dev/null "$BASE_URL/healthz" || die "healthz unreachable"
echo "✓ healthz"

smoke_login "$BASE_URL" "$EMAIL" "$JAR" "$SMOKE_LOG"
uid="$SMOKE_UID"
echo "✓ authenticated ($uid)"

ws_a=$(psql_t "SELECT workspace_id FROM workspace_members
                WHERE user_id = '$uid' ORDER BY created_at LIMIT 1") \
  || die "db unreachable"
[[ "$ws_a" =~ ^[0-9a-fA-F-]{36}$ ]] || die "no workspace for $uid: '$ws_a'"

# --- Seed the caller's tenant: title token + transcript-only word + a
# --- duplicate token hit to prove results are grouped per meeting.
MEETING_A=$(psql_t "INSERT INTO meetings (workspace_id, title, status)
                    VALUES ('$ws_a', 'Search gate $TOKEN', 'completed')
                    RETURNING id")
[ -n "$MEETING_A" ] || die "meeting seed failed"
psql_t "INSERT INTO transcript_segments
          (meeting_id, idx, start_ms, end_ms, text, confidence)
        VALUES
          ('$MEETING_A', 0, 1000, 4000, 'The quorum agrees the plan is sound.', 92),
          ('$MEETING_A', 1, 4000, 8000, 'We will ship $TOKEN next week.', 90),
          ('$MEETING_A', 2, 8000, 12000, 'A second mention of $TOKEN for grouping.', 88)" \
  >/dev/null || die "segment seed failed"

# --- Seed a foreign tenant that shares no membership with the caller.
WS_B=$(psql_t "INSERT INTO workspaces (name, billing_plan, retention_days)
               VALUES ('Search smoke foreign', 'selfhost', 3650)
               RETURNING id")
[ -n "$WS_B" ] || die "foreign workspace seed failed"
psql_t "INSERT INTO meetings (workspace_id, title, status)
        VALUES ('$WS_B', 'Foreign $FOREIGN', 'completed')" >/dev/null
psql_t "INSERT INTO transcript_segments
          (meeting_id, idx, start_ms, end_ms, text, confidence)
        SELECT id, 0, 0, 5000, 'The $FOREIGN decision is confidential.', 95
          FROM meetings WHERE workspace_id = '$WS_B'" >/dev/null \
  || die "foreign segment seed failed"
echo "✓ seeded tenant + foreign meeting"

# --- Generated tsvector columns are real and searchable (not just declared).
vectors=$(psql_t "SELECT count(*) FROM transcript_segments
                   WHERE search_vector @@ websearch_to_tsquery('english', '$TOKEN')")
[ "$vectors" -ge 2 ] || die "expected ≥2 searchable seeded segments, got $vectors"
echo "✓ generated tsvector rows searchable ($vectors segments)"

# --- Title + transcript hit, one row for the meeting (grouped).
resp=$(search_json "$TOKEN") || die "search request failed (title token)"
python3 - "$resp" "$MEETING_A" <<'PY' || die "title assertion failed"
import json, sys
data = json.loads(sys.argv[1])
mid = sys.argv[2]
rows = [r for r in data.get("results", []) if r["meetingId"] == mid]
assert len(rows) == 1, f"expected one grouped row, got {len(rows)}: {data}"
r = rows[0]
assert r["matchedIn"] == "title", r
assert r["snippet"] and any(p["match"] for p in r["snippet"]), r
print(f"✓ title hit grouped ({r['title']!r}, highlighted snippet)")
PY

# --- Transcript-only word: snippet + timestamp + segment deep link.
resp=$(search_json "quorum") || die "search request failed (transcript word)"
python3 - "$resp" "$MEETING_A" <<'PY' || die "transcript assertion failed"
import json, sys
data = json.loads(sys.argv[1])
mid = sys.argv[2]
rows = [r for r in data.get("results", []) if r["meetingId"] == mid]
assert rows, f"seeded meeting missing: {data}"
r = rows[0]
assert r["matchedIn"] == "transcript", r
assert r["segmentIdx"] == 0 and r["startMs"] == 1000, r
assert any(p["match"] for p in r["snippet"]), r
print(f"✓ transcript hit (segment {r['segmentIdx']} @ {r['startMs']}ms)")
PY

# --- UI path: the dashboard renders the hit and the segment deep link loads.
page=$(curl -sf -m 20 -b "$JAR" -G "$BASE_URL/dashboard" \
  --data-urlencode "q=quorum") || die "dashboard search render failed"
echo "$page" | grep -q "$MEETING_A" || die "dashboard results missing the meeting"
echo "$page" | grep -q "seg-0" || die "dashboard results missing the segment link"
echo "✓ dashboard renders the highlighted search result"

curl -sf -m 20 -b "$JAR" \
  "$BASE_URL/dashboard/meetings/$MEETING_A?seg=0" -o /dev/null \
  || die "meeting deep link failed"
echo "✓ meeting deep link renders"

# --- Cross-tenant isolation: the foreign phrase must never be returned.
resp=$(search_json "$FOREIGN") || die "search request failed (foreign token)"
python3 - "$resp" <<'PY' || die "cross-tenant assertion failed"
import json, sys
data = json.loads(sys.argv[1])
assert data.get("count") == 0, f"cross-tenant leak: {data}"
print("✓ cross-tenant search returns 0 rows")
PY

# --- Boundaries.
code=$(curl -s -m 10 -o /dev/null -w '%{http_code}' -G "$BASE_URL/api/search" \
  --data-urlencode "q=$TOKEN")
[ "$code" = "401" ] || die "unauthenticated search returned $code, expected 401"
echo "✓ 401 unauthenticated"

resp=$(search_json "") || die "empty query request failed"
python3 - "$resp" <<'PY' || die "empty query assertion failed"
import json, sys
assert json.loads(sys.argv[1]).get("count") == 0
print("✓ empty query returns 0 rows")
PY

resp=$(search_json "q") || die "short query request failed"
python3 - "$resp" <<'PY' || die "short query assertion failed"
import json, sys
assert json.loads(sys.argv[1]).get("count") == 0
print("✓ 1-character query returns 0 rows")
PY

code=$(curl -s -m 10 -o /dev/null -w '%{http_code}' -b "$JAR" \
  -G "$BASE_URL/api/search" --data-urlencode "q=$(printf 'a%.0s' $(seq 1 201))")
[ "$code" = "400" ] || die "oversized query returned $code, expected 400"
echo "✓ 201-character query rejected (400)"

echo ""
echo "PASS — FTS + trigram search tenant-scoped; positives, grouping and boundaries green"
