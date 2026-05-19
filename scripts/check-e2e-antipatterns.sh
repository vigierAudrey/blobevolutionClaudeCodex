#!/usr/bin/env bash
# check-e2e-antipatterns.sh
# CI guard: blocks E2E anti-patterns that cause false greens, fragile tests, or auth regressions.
# Runs in <2s. Add "// e2e-lint-ok" inline to suppress a specific line (use sparingly).
set -euo pipefail

SPEC_DIR="apps/web/tests/e2e"
FAIL=0
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

blocked() {
  local label="$1"
  local result="$2"
  echo -e "${RED}❌ BLOCKED [$label]${NC}"
  echo "$result"
  echo ""
  FAIL=1
}

check_pattern() {
  local label="$1"
  local pattern="$2"
  local include="${3:---include=*.spec.ts}"

  local result
  # shellcheck disable=SC2086
  result=$(grep -rn $include --extended-regexp "$pattern" "$SPEC_DIR" 2>/dev/null \
    | grep -v "e2e-lint-ok" || true)

  if [ -n "$result" ]; then
    blocked "$label" "$result"
  fi
}

# ── 1. Legacy loginViaApi() ────────────────────────────────────────────────────
check_pattern \
  "loginViaApi — use loginWithCookieSession() from helpers/auth" \
  "loginViaApi\b"

# ── 2. Manual localStorage token storage ──────────────────────────────────────
# Auth tokens must travel as httpOnly cookies, never localStorage.
check_pattern \
  "localStorage.setItem with accessToken/refreshToken — cookie auth only" \
  "localStorage\.setItem\(['\"]accessToken|localStorage\.setItem\(['\"]refreshToken"

# ── 3. Fragile sleep ───────────────────────────────────────────────────────────
check_pattern \
  "waitForTimeout — use toBeVisible()/waitForURL()/expect.poll() instead" \
  "waitForTimeout\("

# ── 4. Brittle CSS class selector ─────────────────────────────────────────────
check_pattern \
  ".divide-y CSS selector — use ARIA/role/text selectors instead" \
  "'\''\.divide-y\b|\"\.divide-y\b"

# ── 5. Conditional count() assertions ─────────────────────────────────────────
# "if (await locator.count() > 0)" is a false-green pattern: the test body
# executes only when elements exist, passing silently when they don't.
# Use expect(...).toBeVisible() or test.skip() with documented reason.
check_pattern \
  "if (await .count()) — false-green pattern; use toBeVisible() or test.skip()" \
  "if \(await .*\.count\(\)"

# ── 6. addCookies() in spec files ─────────────────────────────────────────────
# Partial cookie injection outside the auth helper leads to incomplete sessions.
# All auth must go through loginWithCookieSession() in helpers/auth.ts.
result=$(grep -rn --include="*.spec.ts" "addCookies\b" "$SPEC_DIR" 2>/dev/null \
  | grep -v "e2e-lint-ok" || true)
if [ -n "$result" ]; then
  blocked "addCookies in spec file — use loginWithCookieSession() from helpers/auth" "$result"
fi

# ── Result ─────────────────────────────────────────────────────────────────────
if [ "$FAIL" -eq 0 ]; then
  echo -e "${GREEN}✅ E2E anti-pattern guard passed${NC}"
fi
exit "$FAIL"
