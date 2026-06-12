#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# CI Guardrail: no-legacy-blobinfini-check.sh
#
# Les domaines blobinfini.com / blobinfini.fr sont TERMINÉS (juin 2026).
# Identité publique canonique :
#   https://blobsurf.com          (web)
#   https://api.blobsurf.com     (API)
#   https://storage.blobsurf.com (storage)
#   support@ / security@ / dpo@blobsurf.com
#
# Ce garde-fou échoue si un fichier suivi par git réintroduit un domaine ou
# email legacy (blobinfini.com / blobinfini.fr, sous-domaines et emails
# inclus). Il ne scanne que les fichiers trackés : node_modules, .next, dist,
# storybook-static et coverage sont hors scope par construction (gitignore).
#
# Hors périmètre (volontairement NON bloqués) :
#   - le namespace technique @blobinfini/* (packages npm, non renommés)
#   - les domaines internes *.blobinfini.local (envs dev/pre-VPS)
#   - le mot "Blobinfini" seul (couvert par la revue, pas par ce script)
#
# Exceptions documentées (ALLOWED_PATHS) :
#   - ce script lui-même
#   - apps/web/app/__tests__/no-security-email-placeholder.test.ts
#       (test garde-fou : contient les tokens interdits dans ses assertions)
#   - docs/audits/** (audits historiques datés, non utilisés comme référence
#       opérationnelle — citent l'ancien domaine comme preuve d'époque)
#
# Exit codes :
#   0 — aucun domaine legacy trouvé
#   1 — violation(s) trouvée(s) (la CI doit échouer)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Domaines legacy : couvrent aussi tous les sous-domaines (api., app.,
# storage., anonymized.) et toutes les adresses email (@blobinfini.com…).
FORBIDDEN_PATTERN='blobinfini\.(com|fr)'

ALLOWED_PATHS=(
  "scripts/no-legacy-blobinfini-check.sh"
  "apps/web/app/__tests__/no-security-email-placeholder.test.ts"
  "docs/audits/"
)

is_allowed() {
  local file="$1"
  for allowed in "${ALLOWED_PATHS[@]}"; do
    if [[ "$file" == "$allowed" || "$file" == "$allowed"* ]]; then
      return 0
    fi
  done
  return 1
}

echo ""
echo "=== Legacy Blobinfini Domain Guardrail ==="
echo "Pattern interdit : $FORBIDDEN_PATTERN"
echo ""

VIOLATIONS=0

while IFS= read -r match; do
  file="${match%%:*}"
  if is_allowed "$file"; then
    continue
  fi
  echo "  VIOLATION — $match"
  VIOLATIONS=$((VIOLATIONS + 1))
done < <(
  # --others --exclude-standard : couvre aussi les fichiers nouveaux pas
  # encore commités lors d'un run local (la CI ne voit que des fichiers trackés).
  git ls-files -z --cached --others --exclude-standard \
    | xargs -0 grep -nIiE "$FORBIDDEN_PATTERN" 2>/dev/null || true
)

echo ""
if [[ "$VIOLATIONS" -gt 0 ]]; then
  echo "FAIL: $VIOLATIONS occurrence(s) d'un domaine legacy blobinfini.com/.fr."
  echo ""
  echo "Ces domaines sont terminés. Remplacements canoniques :"
  echo "  https://blobsurf.com / https://api.blobsurf.com / https://storage.blobsurf.com"
  echo "  support@blobsurf.com / security@blobsurf.com / dpo@blobsurf.com"
  echo ""
  echo "Si le fichier est un document strictement historique, l'ajouter à"
  echo "ALLOWED_PATHS dans scripts/no-legacy-blobinfini-check.sh avec justification."
  exit 1
else
  echo "OK: aucun domaine legacy blobinfini.com/.fr dans les fichiers actifs."
  echo ""
  exit 0
fi
