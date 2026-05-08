#!/usr/bin/env bash
# check-authz-route-guards.sh
#
# CI guard: detects sensitive routes in pro/profile controllers without an explicit AuthZ guard.
# This is a net — it catches gross omissions. Unit/e2e tests remain the real proof.
#
# A route is "sensitive" if:
#   - HTTP method is POST, PUT, PATCH, or DELETE, OR
#   - Path contains any of: delete, deletion, photo, export, disciplines, /me, near/lessons
#
# A route passes if its declaration line contains:
#   - requireProRole, requireRiderRole, or requireRole(
#   - OR an inline annotation: // authz-guard-ok: <non-empty justification>
#
# To document an intentional exception (e.g. inline role guard, role-agnostic endpoint):
#   Add  // authz-guard-ok: <clear reason>  at the end of the route declaration line.
#   An empty annotation (no text after the colon) is rejected as a false green.
#
# Usage: bash scripts/check-authz-route-guards.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# AUTHZ_OVERRIDE_FILES: space-separated list of files to scan instead of defaults.
# Used only by the CI self-test (poison pill). Do not set in normal usage.
if [[ -n "${AUTHZ_OVERRIDE_FILES:-}" ]]; then
  # shellcheck disable=SC2206
  IFS=' ' read -r -a FILES <<< "$AUTHZ_OVERRIDE_FILES"
else
  FILES=(
    "$REPO_ROOT/apps/api/src/modules/pro/pro.controller.ts"
    "$REPO_ROOT/apps/api/src/modules/profile/profile.controller.ts"
  )
fi

# Methods that are always sensitive (write/destructive)
SENSITIVE_METHOD_RE="^(post|put|patch|delete)$"

# Path keywords: a GET route is also sensitive if its path contains any of these
SENSITIVE_PATH_RE="(delete|deletion|photo|export|disciplines|/me|near/lessons)"

# Tokens that constitute an explicit role guard (must appear on the route declaration line)
GUARD_RE="(requireProRole|requireRiderRole|requireRole\()"

# Valid exception annotation: // authz-guard-ok: followed by at least one non-whitespace char
AUTHZ_OK_RE="//[[:space:]]*authz-guard-ok:[[:space:]]*[^[:space:]]"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

ERRORS=0

for FILE in "${FILES[@]}"; do
  if [[ ! -f "$FILE" ]]; then
    printf "${RED}ERROR: File not found: %s${NC}\n" "$FILE" >&2
    exit 2
  fi

  LINE_NUM=0
  while IFS= read -r LINE; do
    LINE_NUM=$((LINE_NUM + 1))

    # Only process Express route declarations
    if ! printf '%s' "$LINE" | grep -qE '(proRouter|profileRouter)\.(post|put|patch|delete|get)\('; then
      continue
    fi

    # Extract HTTP method (lowercase)
    METHOD=$(printf '%s' "$LINE" | grep -oE '\.(post|put|patch|delete|get)\(' | head -1 | tr -d '.(' )

    # Extract route path: first quoted string in the line
    ROUTE_PATH=$(printf '%s' "$LINE" | grep -oE "('[^']*'|\"[^\"]*\")" | head -1 | tr -d "'\"")

    # Determine if this route is sensitive
    SENSITIVE=0
    if printf '%s' "$METHOD" | grep -qE "$SENSITIVE_METHOD_RE"; then
      SENSITIVE=1
    fi
    if printf '%s' "$ROUTE_PATH" | grep -qE "$SENSITIVE_PATH_RE"; then
      SENSITIVE=1
    fi
    [[ "$SENSITIVE" -eq 0 ]] && continue

    # Check for an explicit role guard token on this line
    if printf '%s' "$LINE" | grep -qE "$GUARD_RE"; then
      continue  # guarded ✅
    fi

    # Check for a valid authz-guard-ok annotation with non-empty justification
    if printf '%s' "$LINE" | grep -qE "$AUTHZ_OK_RE"; then
      continue  # documented exception ✅
    fi

    # Catch annotation present but empty justification (misuse that would create false greens)
    if printf '%s' "$LINE" | grep -q "authz-guard-ok"; then
      printf "${RED}❌ %s:%d — %s '%s': authz-guard-ok annotation has no justification.${NC}\n" \
        "$FILE" "$LINE_NUM" "$METHOD" "$ROUTE_PATH" >&2
      printf "   → Justification required: '// authz-guard-ok: <clear reason>'\n" >&2
      ERRORS=$((ERRORS + 1))
      continue
    fi

    # Missing guard — report with actionable message
    printf "${RED}❌ %s:%d — %s '%s': sensitive route has no AuthZ guard.${NC}\n" \
      "$FILE" "$LINE_NUM" "$METHOD" "$ROUTE_PATH" >&2
    printf "   → Add requireProRole, requireRiderRole, requireRole(...), or\n" >&2
    printf "     '// authz-guard-ok: <reason>' on the route declaration line.\n" >&2
    ERRORS=$((ERRORS + 1))

  done < "$FILE"
done

if [[ "$ERRORS" -gt 0 ]]; then
  printf "\n${RED}❌ %d sensitive route(s) without AuthZ guard.${NC}\n" "$ERRORS" >&2
  exit 1
fi

printf "${GREEN}✅ AuthZ route guard passed — all sensitive routes are guarded.${NC}\n"
