#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────
# Misoki E2E Validation Script
#
# Validates the analysis service end-to-end against a live instance.
# Requires: curl, jq, and the analysis service running on $BASE_URL.
#
# Usage:
#   ./scripts/e2e-validate.sh                        # uses localhost:8000
#   BASE_URL=http://my-host:8000 ./scripts/e2e-validate.sh
#   DEMO_REPO=https://github.com/owner/repo ./scripts/e2e-validate.sh
# ──────────────────────────────────────────────────────────────────────
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8000}"
DEMO_REPO="${DEMO_REPO:-https://github.com/pallets/click}"
MAX_FILES="${MAX_FILES:-3}"
TIMEOUT="${TIMEOUT:-90}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

PASSED=0
FAILED=0

pass() { PASSED=$((PASSED + 1)); echo -e "  ${GREEN}✓${NC} $1"; }
fail() { FAILED=$((FAILED + 1)); echo -e "  ${RED}✗${NC} $1"; }

echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  Misoki E2E Validation${NC}"
echo -e "${CYAN}  Base URL:  ${BASE_URL}${NC}"
echo -e "${CYAN}  Demo repo: ${DEMO_REPO}${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
echo ""

# ── Step 1: Health check ──────────────────────────────────────────────
echo -e "${YELLOW}Step 1: Health check${NC}"

HEALTH=$(curl -sf --max-time 10 "${BASE_URL}/health" 2>/dev/null || echo '{"status":"FAIL"}')
HEALTH_STATUS=$(echo "$HEALTH" | jq -r '.status // "FAIL"')

if [ "$HEALTH_STATUS" = "ok" ]; then
  pass "Health endpoint returned status=ok"
else
  fail "Health endpoint returned status=${HEALTH_STATUS}"
  echo -e "  ${RED}Cannot continue — analysis service is not reachable at ${BASE_URL}${NC}"
  exit 1
fi

echo ""

# ── Step 2: Analyze a repository ──────────────────────────────────────
echo -e "${YELLOW}Step 2: Analyze repository (max_files=${MAX_FILES})${NC}"

ANALYZE_RESP=$(curl -sf --max-time "$TIMEOUT" \
  -X POST "${BASE_URL}/analyze/repo" \
  -H "Content-Type: application/json" \
  -d "{
    \"github_url\": \"${DEMO_REPO}\",
    \"max_files\": ${MAX_FILES},
    \"include_categories\": [\"architecture\", \"dead_code\", \"performance\"]
  }" 2>/dev/null || echo '{"error":"request failed"}')

REPO=$(echo "$ANALYZE_RESP" | jq -r '.repo // empty')
COMMIT=$(echo "$ANALYZE_RESP" | jq -r '.commit // empty')
FILES_SCANNED=$(echo "$ANALYZE_RESP" | jq -r '.files_scanned // 0')
ISSUE_COUNT=$(echo "$ANALYZE_RESP" | jq '.issues | length')
FIXABLE_COUNT=$(echo "$ANALYZE_RESP" | jq '[.issues[] | select(.fixable == true)] | length')

if [ -n "$REPO" ] && [ -n "$COMMIT" ]; then
  pass "Analyze returned repo=${REPO}, commit=${COMMIT:0:7}"
else
  fail "Analyze did not return expected fields"
  echo "$ANALYZE_RESP" | jq . 2>/dev/null || echo "$ANALYZE_RESP"
  exit 1
fi

if [ "$FILES_SCANNED" -gt 0 ]; then
  pass "Scanned ${FILES_SCANNED} file(s)"
else
  fail "No files were scanned"
fi

pass "Found ${ISSUE_COUNT} issue(s), ${FIXABLE_COUNT} fixable"

# Validate issue structure
FIRST_ISSUE_FILE=$(echo "$ANALYZE_RESP" | jq -r '.issues[0].file // empty')
FIRST_ISSUE_FIXID=$(echo "$ANALYZE_RESP" | jq -r '.issues[0].fix_id // empty')
if [ -n "$FIRST_ISSUE_FILE" ] && [ -n "$FIRST_ISSUE_FIXID" ]; then
  pass "Issue structure valid (file=${FIRST_ISSUE_FILE}, fix_id present)"
else
  fail "Issue structure missing expected fields"
fi

echo ""

# ── Step 3: Preview a fix ────────────────────────────────────────────
echo -e "${YELLOW}Step 3: Preview a fix${NC}"

# Pick the first fixable issue, or fall back to first issue
PREVIEW_FIX_ID=$(echo "$ANALYZE_RESP" | jq -r '[.issues[] | select(.fixable == true)][0].fix_id // .issues[0].fix_id // empty')

if [ -z "$PREVIEW_FIX_ID" ]; then
  echo -e "  ${YELLOW}⚠ No issues to preview — skipping${NC}"
else
  PREVIEW_RESP=$(curl -sf --max-time 30 \
    -X POST "${BASE_URL}/preview/fix" \
    -H "Content-Type: application/json" \
    -d "{
      \"github_url\": \"${DEMO_REPO}\",
      \"fix_id\": \"${PREVIEW_FIX_ID}\"
    }" 2>/dev/null || echo '{"error":"request failed"}')

  PREVIEW_FILE=$(echo "$PREVIEW_RESP" | jq -r '.file // empty')
  PREVIEW_RISK=$(echo "$PREVIEW_RESP" | jq -r '.risk // empty')
  PREVIEW_SUPPORTED=$(echo "$PREVIEW_RESP" | jq -r '.supported // false')

  if [ -n "$PREVIEW_FILE" ]; then
    pass "Preview returned file=${PREVIEW_FILE}, risk=${PREVIEW_RISK}, supported=${PREVIEW_SUPPORTED}"
  else
    fail "Preview did not return expected fields"
    echo "$PREVIEW_RESP" | jq . 2>/dev/null || echo "$PREVIEW_RESP"
  fi

  if [ "$PREVIEW_SUPPORTED" = "true" ]; then
    DIFF_LEN=$(echo "$PREVIEW_RESP" | jq -r '.diff | length')
    if [ "$DIFF_LEN" -gt 0 ]; then
      pass "Diff is non-empty (${DIFF_LEN} chars)"
    else
      fail "Diff is empty for a supported fix"
    fi
  fi
fi

echo ""

# ── Step 4: Apply safe fixes ─────────────────────────────────────────
echo -e "${YELLOW}Step 4: Apply safe fixes${NC}"

FIXABLE_IDS=$(echo "$ANALYZE_RESP" | jq -c '[.issues[] | select(.fixable == true) | .fix_id]')
FIXABLE_LEN=$(echo "$FIXABLE_IDS" | jq 'length')

if [ "$FIXABLE_LEN" -eq 0 ]; then
  echo -e "  ${YELLOW}⚠ No fixable issues — skipping apply step${NC}"
else
  APPLY_RESP=$(curl -sf --max-time 30 \
    -X POST "${BASE_URL}/apply/fixes" \
    -H "Content-Type: application/json" \
    -d "{
      \"github_url\": \"${DEMO_REPO}\",
      \"fix_ids\": ${FIXABLE_IDS}
    }" 2>/dev/null || echo '{"error":"request failed"}')

  APPLIED=$(echo "$APPLY_RESP" | jq -r '.applied_count // 0')
  SKIPPED=$(echo "$APPLY_RESP" | jq -r '.skipped_count // 0')
  CHANGED_FILES=$(echo "$APPLY_RESP" | jq '.files | length')

  pass "Apply result: ${APPLIED} applied, ${SKIPPED} skipped, ${CHANGED_FILES} file(s) changed"

  if [ "$APPLIED" -gt 0 ]; then
    DIFF_PRESENT=$(echo "$APPLY_RESP" | jq -r '.combined_diff | length')
    if [ "$DIFF_PRESENT" -gt 0 ]; then
      pass "Combined diff is non-empty"
    else
      fail "Combined diff is empty despite applied fixes"
    fi
  fi
fi

echo ""

# ── Step 5: Error handling ────────────────────────────────────────────
echo -e "${YELLOW}Step 5: Error handling${NC}"

BAD_URL_STATUS=$(curl -so /dev/null -w "%{http_code}" --max-time 10 \
  -X POST "${BASE_URL}/analyze/repo" \
  -H "Content-Type: application/json" \
  -d '{"github_url": "not-a-url"}' 2>/dev/null || echo "000")

if [ "$BAD_URL_STATUS" = "400" ]; then
  pass "Bad URL returns 400"
else
  fail "Bad URL returned ${BAD_URL_STATUS} (expected 400)"
fi

BAD_FIX_STATUS=$(curl -so /dev/null -w "%{http_code}" --max-time 10 \
  -X POST "${BASE_URL}/preview/fix" \
  -H "Content-Type: application/json" \
  -d "{\"github_url\": \"${DEMO_REPO}\", \"fix_id\": \"bad\"}" 2>/dev/null || echo "000")

if [ "$BAD_FIX_STATUS" = "400" ]; then
  pass "Bad fix_id returns 400"
else
  fail "Bad fix_id returned ${BAD_FIX_STATUS} (expected 400)"
fi

EMPTY_IDS_STATUS=$(curl -so /dev/null -w "%{http_code}" --max-time 10 \
  -X POST "${BASE_URL}/apply/fixes" \
  -H "Content-Type: application/json" \
  -d "{\"github_url\": \"${DEMO_REPO}\", \"fix_ids\": []}" 2>/dev/null || echo "000")

if [ "$EMPTY_IDS_STATUS" = "422" ]; then
  pass "Empty fix_ids returns 422"
else
  fail "Empty fix_ids returned ${EMPTY_IDS_STATUS} (expected 422)"
fi

echo ""

# ── Summary ───────────────────────────────────────────────────────────
echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
TOTAL=$((PASSED + FAILED))
if [ "$FAILED" -eq 0 ]; then
  echo -e "${GREEN}  All ${TOTAL} checks passed!${NC}"
else
  echo -e "${RED}  ${FAILED}/${TOTAL} checks failed${NC}"
fi
echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"

exit "$FAILED"
