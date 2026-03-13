#!/usr/bin/env bash
# NO UNSAFE DB PUSH GUARDRAIL
#
# Détecte les flags dangereux (flag de perte de données, script push marqué unsafe)
# dans les fichiers de configuration et scripts hors des wrappers locaux autorisés.
#
# Exclusions autorisées:
#   - packages/database/scripts/safe-db-push.mjs  (wrapper local avec garde-fous)
#   - packages/database/package.json              (script npm déclaratif, pas exécuté en CI)
#   - .github/workflows/** et .github/actions/**  (scanné par ci-block-db-push.sh)
#
# Usage:
#   bash scripts/no-unsafe-db-push-check.sh
#   Exit 0 = OK, Exit 1 = violation détectée
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Patterns séparés pour éviter l'auto-détection de ce script
PATTERN_ADL='accept-data''-loss'
PATTERN_DPU='db:push'':unsafe'

UNSAFE_HITS="$(
  find . -type f \
    \( -name '*.sh' -o -name '*.mjs' -o -name 'package.json' -o -name '*.yml' -o -name '*.yaml' \) \
    ! -path './.git/*' \
    ! -path './.github/workflows/*' \
    ! -path './.github/actions/*' \
    ! -path './.gitlab-ci.yml' \
    ! -path './.gitlab/*' \
    ! -path './node_modules/*' \
    ! -path './apps/web/.next/*' \
    ! -path './apps/web/storybook-static/*' \
    ! -path './packages/database/scripts/safe-db-push.mjs' \
    ! -path './packages/database/package.json' \
    ! -path './scripts/no-unsafe-db-push-check.sh' \
    ! -path './scripts/ci-block-db-push.sh' \
    -print0 \
    | xargs -0 -r grep -I -nE "${PATTERN_ADL}|${PATTERN_DPU}" \
    || true
)"

if [ -n "$UNSAFE_HITS" ]; then
  echo "❌ Forbidden unsafe DB push guardrail bypass detected."
  echo "$UNSAFE_HITS"
  exit 1
fi

echo "✅ no-unsafe-db-push-check: no forbidden unsafe db push bypass outside approved local wrappers."
