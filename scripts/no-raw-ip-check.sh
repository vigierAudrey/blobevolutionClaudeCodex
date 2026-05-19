#!/bin/bash
# NO RAW IP GUARDRAIL - RGPD Compliance Check
#
# This script prevents raw IP addresses from being exposed in:
# - HTTP responses (res.json/res.send)
# - Application logs (secureLogger)
# - Prisma selects returned to clients
# - GDPR exports
#
# Exceptions:
# - AdminProfile.allowedIPs (whitelist, must remain raw IPs for functionality)
# - Test files (*.test.ts, *.spec.ts)
#
# Usage:
#   ./scripts/no-raw-ip-check.sh
#   Exit code 0 = OK, Exit code 1 = violations found
#
# Add to package.json:
#   "test:security": "bash scripts/no-raw-ip-check.sh"
#
# Add to CI (GitHub Actions, etc.):
#   - run: npm run test:security

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_SRC_DIR="$SCRIPT_DIR/../apps/api/src"

echo "🔐 RGPD IP Privacy Guardrail Check"
echo "=================================="
echo ""

VIOLATIONS_FOUND=0

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to check for violations
check_pattern() {
  local pattern="$1"
  local description="$2"
  local exclude_pattern="${3:-}"

  echo -n "Checking: $description... "

  # Build grep command
  local grep_cmd="grep -rn -E \"$pattern\" \"$API_SRC_DIR\" --include=\"*.ts\" --exclude=\"*.test.ts\" --exclude=\"*.spec.ts\""

  # Add exclusions if provided
  if [ -n "$exclude_pattern" ]; then
    grep_cmd="$grep_cmd | grep -v -E \"$exclude_pattern\""
  fi

  # Run grep and capture results
  local results
  results=$(eval "$grep_cmd" 2>/dev/null || true)

  if [ -z "$results" ]; then
    echo -e "${GREEN}✓ OK${NC}"
    return 0
  else
    echo -e "${RED}✗ VIOLATION FOUND${NC}"
    echo "$results" | head -10
    if [ "$(echo "$results" | wc -l)" -gt 10 ]; then
      echo -e "${YELLOW}... and $(($(echo "$results" | wc -l) - 10)) more violations${NC}"
    fi
    echo ""
    VIOLATIONS_FOUND=$((VIOLATIONS_FOUND + 1))
    return 1
  fi
}

# CHECK 1: Prevent raw IP in HTTP responses
echo ""
echo "📡 HTTP Response Checks"
echo "-----------------------"
check_pattern \
  "res\.(json|send).*\{[^}]*(clientIP|clientIp|ipAddress):" \
  "Raw IP in HTTP response (clientIP/clientIp/ipAddress)" \
  "admin.*allowedIPs"

# CHECK 2: Prevent raw IP in logs
echo ""
echo "📋 Logging Checks"
echo "-----------------"
check_pattern \
  "secureLogger\.(info|warn|error|security).*\{[^}]*\bip:" \
  "Raw IP in secureLogger (use ipHash instead)" \
  "ipHash:|ip:.*(Hash|hash)"

check_pattern \
  "\bip:\s*(req\.ip|getClientIp\(|[^,]*remoteAddress|[^,]*canonicalIp)" \
  "Raw IP sourced from request context in runtime code" \
  "allowedIPs"

# CHECK 3: Prevent consentIp in selects returned to client
echo ""
echo "💾 Database Select Checks"
echo "-------------------------"
check_pattern \
  "select:.*\{[^}]*consentIp:\s*true" \
  "consentIp in Prisma select (use consentIpHash)" \
  ""

# CHECK 4: Prevent LoginAttempt.ip in queries/responses
check_pattern \
  "\.ip:\s*\{.*in:" \
  "LoginAttempt.ip in WHERE clause (use ipHash)" \
  "\.ipHash:|allowedIPs"

# CHECK 5: Verify hashIp() v1 is not imported (except tests/legacy)
echo ""
echo "🔒 Hash Function Checks"
echo "-----------------------"
check_pattern \
  "import.*\{[^}]*\bhashIp\b[^}]*\}.*from.*client-ip" \
  "hashIp() v1 imported (use hashIpHmac from hash-ip)" \
  "test|spec|@deprecated"

# CHECK 6: Prevent pseudonymizeIP usage (deprecated)
check_pattern \
  "pseudonymizeIP\(" \
  "pseudonymizeIP() usage (deprecated, use ipHash)" \
  "@deprecated|function pseudonymizeIP"

# Final report
echo ""
echo "=================================="
if [ $VIOLATIONS_FOUND -eq 0 ]; then
  echo -e "${GREEN}✅ All checks passed!${NC}"
  echo "No raw IP leaks detected."
  echo ""
  exit 0
else
  echo -e "${RED}❌ Found $VIOLATIONS_FOUND violation(s)${NC}"
  echo ""
  echo "RGPD IP Privacy Violations Detected!"
  echo "Please fix the issues above before committing."
  echo ""
  echo "Allowed patterns:"
  echo "  ✓ ipHash (HMAC-SHA256)"
  echo "  ✓ consentIpHash (HMAC-SHA256)"
  echo "  ✓ AdminProfile.allowedIPs (whitelist exception)"
  echo ""
  echo "Forbidden patterns:"
  echo "  ✗ clientIP / clientIp / ipAddress in res.json()"
  echo "  ✗ ip: in secureLogger.* including secureLogger.security (use ipHash:)"
  echo "  ✗ ip: req.ip|getClientIp(... )|remoteAddress|canonicalIp in runtime code"
  echo "  ✗ consentIp: true in select"
  echo "  ✗ LoginAttempt.ip in queries"
  echo "  ✗ hashIp() from client-ip (use hashIpHmac())"
  echo ""
  exit 1
fi
