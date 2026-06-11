#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# CI Guardrail: no-direct-ip-access.sh
#
# Blocks any use of raw IP sources outside the authorised helpers.
# Forbidden patterns:
#
#   req\.ip[^s]       — Express built-in; honours trust proxy but bypasses our
#                        TRUST_PROXY_MODE policy and normalisation logic.
#   req\[['"]ip['"]\] — Bracket notation alias for the same property.
#   x-forwarded-for   — Raw header; NEVER read directly outside client-ip.ts.
#   headers\[.x-forwarded-for.\] — Same, bracket notation.
#
# Why bracket notation matters:
#   req['ip'] is semantically identical to req.ip and bypasses the dot-notation
#   pattern. Both must be blocked outside the authorised helpers.
#
# Not yet detected (hard to grep reliably without false positives):
#   const { ip } = req   — destructuring bypass; use code review to enforce.
#   const r = req; r.ip  — alias via variable; use code review to enforce.
#
# Authorised reads (excluded from the scan):
#   apps/api/src/lib/client-ip.ts          — the canonical helper itself
#   apps/api/src/middleware/canonical-ip.ts — the stamping middleware
#   apps/api/src/lib/__tests__/pentest.*   — pentest scaffolding (controlled)
#   apps/api/src/lib/__tests__/client-ip.* — unit tests for the helper
#   apps/api/src/observability/__tests__/  — log-serializer tests (verify XFF is REDACTED)
#
# Exit codes:
#   0 — no violations found
#   1 — violations found (CI must fail)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SRC_DIR="$REPO_ROOT/apps/api/src"

# Files allowed to contain forbidden patterns (canonical helpers + tests)
ALLOWED_FILES=(
  "apps/api/src/lib/client-ip.ts"
  "apps/api/src/middleware/canonical-ip.ts"
)

ALLOWED_GLOBS=(
  "apps/api/src/lib/__tests__/pentest."
  "apps/api/src/lib/__tests__/client-ip"
  "apps/api/src/lib/__tests__/createApp."
  "apps/api/src/lib/__tests__/env-validation."
  "apps/api/src/modules/analytics/__tests__/"
  "apps/api/src/lib/hash-ip"
  "apps/api/src/lib/logger/__tests__/"
  "apps/api/src/observability/__tests__/"
)

VIOLATIONS=0

# ─── Helper ──────────────────────────────────────────────────────────────────

is_allowed() {
  local file="$1"
  local rel="${file#"$REPO_ROOT/"}"

  for allowed in "${ALLOWED_FILES[@]}"; do
    if [[ "$rel" == "$allowed" ]]; then
      return 0
    fi
  done

  for glob in "${ALLOWED_GLOBS[@]}"; do
    if [[ "$rel" == *"$glob"* ]]; then
      return 0
    fi
  done

  return 1
}

check_pattern() {
  local label="$1"
  local pattern="$2"

  echo "Checking: $label"

  while IFS= read -r match; do
    # Extract filename (before first colon)
    local file="${match%%:*}"

    if is_allowed "$file"; then
      continue
    fi

    # Skip lines that are purely comments (JSDoc /** * ... */ or // ...)
    # Extract the code content after "filename:linenum:"
    local code_part="${match#*:*:}"
    local trimmed
    trimmed="$(echo "$code_part" | sed 's/^[[:space:]]*//')"
    if [[ "$trimmed" == //* ]] || [[ "$trimmed" == \** ]] || [[ "$trimmed" == \/* ]]; then
      continue
    fi

    echo "  VIOLATION [$label] — $match"
    VIOLATIONS=$((VIOLATIONS + 1))
  done < <(
    grep -rn --include="*.ts" -E "$pattern" "$SRC_DIR" 2>/dev/null || true
  )
}

# ─── Checks ──────────────────────────────────────────────────────────────────

echo ""
echo "=== IP Access Guardrail ==="
echo "Scanning: $SRC_DIR"
echo ""

# 1. Direct req.ip access in non-trivial contexts
#    Allowed: req.ip in comments, req.ips (the array, fine), req.hostname
#    Blocked: req.ip standalone assignment/comparison/logging
check_pattern "req.ip (direct dot-notation)" \
  'req\.ip[^s]'

# 2. Bracket notation: req['ip'] or req["ip"]
#    Semantically identical to req.ip — must be blocked everywhere outside helpers.
check_pattern "req['ip'] or req[\"ip\"] (bracket notation bypass)" \
  "req\[['\"]ip['\"]\]"

# 3. Raw x-forwarded-for header reads
check_pattern "x-forwarded-for (raw header read)" \
  "x-forwarded-for"

# 4. Bracket notation header read
check_pattern "req.headers[x-forwarded-for] (bracket)" \
  "headers\[.x-forwarded-for.\]"

# ─── Result ──────────────────────────────────────────────────────────────────

echo ""
if [[ "$VIOLATIONS" -gt 0 ]]; then
  echo "FAIL: $VIOLATIONS violation(s) found."
  echo ""
  echo "Fix: replace req.ip / raw XFF header reads with:"
  echo "  import { getClientIp } from '../lib/client-ip';"
  echo "  const ip = req.canonicalIp ?? getClientIp(req) ?? req.socket?.remoteAddress;"
  echo ""
  exit 1
else
  echo "OK: No direct IP access violations found."
  echo ""
  exit 0
fi
