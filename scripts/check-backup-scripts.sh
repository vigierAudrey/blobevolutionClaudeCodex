#!/usr/bin/env bash
# check-backup-scripts.sh — Vérifie la syntaxe bash des scripts de backup
#
# Usage: bash scripts/check-backup-scripts.sh
# Exit 0 = OK, Exit 1 = erreur de syntaxe détectée

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ERRORS=0

for script in \
  "$ROOT_DIR/scripts/backup-pg.sh" \
  "$ROOT_DIR/scripts/restore-pg.sh"
do
  if bash -n "$script" 2>&1; then
    echo "✅ check-backup-scripts: syntaxe OK — $(basename "$script")"
  else
    echo "❌ check-backup-scripts: erreur de syntaxe dans $(basename "$script")"
    ERRORS=$(( ERRORS + 1 ))
  fi
done

if [[ $ERRORS -gt 0 ]]; then
  echo "❌ check-backup-scripts: $ERRORS script(s) avec erreur de syntaxe."
  exit 1
fi

echo "✅ check-backup-scripts: tous les scripts de backup sont valides."
