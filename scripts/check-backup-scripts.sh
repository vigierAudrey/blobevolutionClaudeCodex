#!/usr/bin/env bash
# check-backup-scripts.sh — Vérifie la syntaxe bash des scripts de backup
#
# Usage: bash scripts/check-backup-scripts.sh
# Exit 0 = OK, Exit 1 = erreur de syntaxe ou script manquant

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ERRORS=0
HAS_SHELLCHECK=false
command -v shellcheck >/dev/null 2>&1 && HAS_SHELLCHECK=true

# Scripts requis : uniquement ceux qui doivent exister dans ce projet
declare -a REQUIRED_SCRIPTS=(
  "$ROOT_DIR/scripts/backup-encrypt-upload.sh"
  "$ROOT_DIR/scripts/r2-rotate.sh"
  "$ROOT_DIR/scripts/r2-restore-test.sh"
  "$ROOT_DIR/scripts/setup-backup-keys.sh"
)

# Scripts optionnels (pas d'erreur si absents)
declare -a OPTIONAL_SCRIPTS=(
  "$ROOT_DIR/scripts/backup-pg.sh"
  "$ROOT_DIR/scripts/restore-pg.sh"
  "$ROOT_DIR/scripts/backup-blobsurf.sh"
  "$ROOT_DIR/scripts/backup-minio.sh"
  "$ROOT_DIR/scripts/alert.sh"
)

_check_script() {
  local script="$1"
  local required="${2:-true}"
  local name
  name="$(basename "$script")"

  if [[ ! -f "$script" ]]; then
    if [[ "$required" == "true" ]]; then
      echo "❌ check-backup-scripts: MANQUANT (requis) — $name"
      ERRORS=$(( ERRORS + 1 ))
    else
      echo "   check-backup-scripts: absent (optionnel) — $name"
    fi
    return
  fi

  local syntax_ok=true
  if ! bash -n "$script" 2>/tmp/check-syntax-err; then
    echo "❌ check-backup-scripts: erreur de syntaxe bash — $name"
    cat /tmp/check-syntax-err
    ERRORS=$(( ERRORS + 1 ))
    syntax_ok=false
  fi

  if $HAS_SHELLCHECK && $syntax_ok; then
    if shellcheck -S warning "$script" 2>/tmp/check-shellcheck-err; then
      echo "✅ check-backup-scripts: bash -n + shellcheck OK — $name"
    else
      echo "⚠️  check-backup-scripts: shellcheck avertissements — $name"
      cat /tmp/check-shellcheck-err
      # shellcheck : avertissements non bloquants (pas d'incrément ERRORS)
    fi
  elif $syntax_ok; then
    echo "✅ check-backup-scripts: bash -n OK (shellcheck non disponible) — $name"
  fi
}

for s in "${REQUIRED_SCRIPTS[@]}"; do
  _check_script "$s" "true"
done

for s in "${OPTIONAL_SCRIPTS[@]}"; do
  _check_script "$s" "false"
done

rm -f /tmp/check-syntax-err /tmp/check-shellcheck-err

if [[ $ERRORS -gt 0 ]]; then
  echo "❌ check-backup-scripts: $ERRORS erreur(s) détectée(s)."
  exit 1
fi

echo "✅ check-backup-scripts: tous les scripts requis sont valides."
