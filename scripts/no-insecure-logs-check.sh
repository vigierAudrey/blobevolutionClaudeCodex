#!/usr/bin/env bash
# NO INSECURE LOGS GUARDRAIL
#
# Détecte les patterns de logs qui exposent des secrets/PII dans les fichiers runtime.
# Exclut: tests, test-utils, storybook, .next, node_modules.
#
# Usage:
#   bash scripts/no-insecure-logs-check.sh
#   Exit 0 = OK, Exit 1 = violation détectée
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

scan_runtime_files() {
  find apps/api/src apps/web -type f \
    ! -path '*/__tests__/*' \
    ! -path '*/test-utils/*' \
    ! -path '*/scripts/*' \
    ! -path '*/storybook-static/*' \
    ! -path '*/.next/*' \
    ! -path '*/node_modules/*' \
    ! -name '*.test.*' \
    ! -name '*.spec.*' \
    -print0
}

CONSOLE_HITS="$(
  scan_runtime_files \
    | xargs -0 -r grep -I -nE \
      'console\.(log|warn|error).*((process\.env)|(req\.(headers|cookies))|(Authorization)|(Bearer[[:space:]])|(accessToken[^[:alnum:]_])|(refreshToken[^[:alnum:]_]))' \
      || true
)"

CONSOLE_EMAIL_HITS="$(
  scan_runtime_files \
    | xargs -0 -r grep -I -nE \
      'console\.(log|warn|error|info).*((mail\.to)|(userEmail[^[:alnum:]_])|(ADMIN_EMAIL)|(this\.ADMIN_EMAIL))' \
      || true
)"

LOGGER_HITS="$(
  scan_runtime_files \
    | xargs -0 -r grep -I -nE \
      'secureLogger\.(info|warn|error|security).*\{[^}]*\b(accessToken|refreshToken|authorization|password|token|secret)\s*:' \
    || true
)"

if [ -n "$CONSOLE_HITS" ] || [ -n "$CONSOLE_EMAIL_HITS" ] || [ -n "$LOGGER_HITS" ]; then
  echo "❌ Insecure logs / secrets detected in runtime source files."
  if [ -n "$CONSOLE_HITS" ]; then
    echo "$CONSOLE_HITS"
  fi
  if [ -n "$CONSOLE_EMAIL_HITS" ]; then
    echo "$CONSOLE_EMAIL_HITS"
  fi
  if [ -n "$LOGGER_HITS" ]; then
    echo "$LOGGER_HITS"
  fi
  exit 1
fi

echo "✅ no-insecure-logs-check: no sensitive runtime log patterns detected."
