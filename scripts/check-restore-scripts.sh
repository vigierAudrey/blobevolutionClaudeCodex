#!/usr/bin/env bash
# check-restore-scripts.sh — Garde-fou statique des scripts de restore drill
#
# Vérifie SANS toucher à aucune base de données :
#   - présence du script restore-postgres-drill.sh ;
#   - `bash -n` (syntaxe) sur les scripts de restore ;
#   - présence des garde-fous anti-prod attendus ;
#   - absence de `prisma db push` destructif (flag de perte de données) ;
#   - absence de log de connection string / mot de passe ;
#   - shellcheck si disponible (avertissements non bloquants).
#
# Usage : bash scripts/check-restore-scripts.sh
#   Exit 0 = OK, Exit 1 = violation détectée.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ERRORS=0
HAS_SHELLCHECK=false
command -v shellcheck >/dev/null 2>&1 && HAS_SHELLCHECK=true

DRILL="scripts/restore-postgres-drill.sh"
# Scripts de restore concernés par les checks de log de secret.
RESTORE_SCRIPTS=("$DRILL" "scripts/restore-pg.sh")

fail() { echo "❌ check-restore-scripts: $*"; ERRORS=$(( ERRORS + 1 )); }
ok()   { echo "✅ check-restore-scripts: $*"; }

# ─── 1. Présence + syntaxe ─────────────────────────────────────────────────────
if [[ ! -f "$DRILL" ]]; then
  fail "MANQUANT — $DRILL"
else
  if bash -n "$DRILL" 2>/tmp/check-restore-syntax; then
    ok "bash -n OK — $DRILL"
  else
    fail "erreur de syntaxe bash — $DRILL"
    cat /tmp/check-restore-syntax
  fi
fi

# ─── 2. Garde-fous anti-prod attendus dans le drill ────────────────────────────
if [[ -f "$DRILL" ]]; then
  declare -A GUARDS=(
    ["cible RESTORE_TARGET_DATABASE_URL requise"]='RESTORE_TARGET_DATABASE_URL'
    ["refus si cible == DATABASE_URL"]='identique à DATABASE_URL'
    ["garde-fou NODE_ENV=production"]='ALLOW_RESTORE_DRILL'
    ["marqueur sûr dans le nom de DB"]='SAFE_MARKERS_REGEX'
    ["motif prod interdit"]='FORBIDDEN_REGEX'
    ["mode dry-run"]='--dry-run'
  )
  for label in "${!GUARDS[@]}"; do
    if grep -q -- "${GUARDS[$label]}" "$DRILL"; then
      ok "garde-fou présent — $label"
    else
      fail "garde-fou ABSENT — $label"
    fi
  done
fi

# ─── 3. Absence de prisma db push destructif ───────────────────────────────────
# Pattern reconstruit pour éviter l'auto-détection de ce script.
PATTERN_ADL='accept-data''-loss'
for s in "${RESTORE_SCRIPTS[@]}"; do
  [[ -f "$s" ]] || continue
  if grep -nE "push.*${PATTERN_ADL}|${PATTERN_ADL}" "$s" \
       | grep -vqE 'INTERDIT|Jamais|jamais|#'; then
    fail "usage potentiel de db push destructif — $s"
  fi
done
ok "aucun db push destructif hors commentaire d'avertissement"

# ─── 4. Aucun log de connection string / mot de passe ──────────────────────────
# Détecte un echo/log/printf qui imprimerait une URL de connexion ou un mot de passe.
SECRET_VARS='RESTORE_TARGET_DATABASE_URL|DATABASE_URL|TARGET_URL|DB_PASS|TARGET_PASS|PGPASSWORD'
for s in "${RESTORE_SCRIPTS[@]}"; do
  [[ -f "$s" ]] || continue
  if grep -nE '^[[:space:]]*(log|echo|printf)[[:space:]].*\$\{?('"$SECRET_VARS"')' "$s"; then
    fail "log potentiel d'une connection string / mot de passe — $s"
  fi
done
ok "aucun log de connection string / mot de passe détecté"

# ─── 5. shellcheck (non bloquant) ──────────────────────────────────────────────
if $HAS_SHELLCHECK && [[ -f "$DRILL" ]]; then
  if shellcheck -S warning "$DRILL" 2>/tmp/check-restore-shellcheck; then
    ok "shellcheck OK — $DRILL"
  else
    echo "⚠️  check-restore-scripts: shellcheck avertissements — $DRILL"
    cat /tmp/check-restore-shellcheck
  fi
fi

rm -f /tmp/check-restore-syntax /tmp/check-restore-shellcheck

if (( ERRORS > 0 )); then
  echo "❌ check-restore-scripts: $ERRORS erreur(s) détectée(s)."
  exit 1
fi
echo "✅ check-restore-scripts: tous les garde-fous restore sont présents et valides."
