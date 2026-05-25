#!/usr/bin/env bash
# check-caddy-syntax.sh — Guard CI : interdit {env.VAR} dans les Caddyfiles.
#
# Caddy utilise {$VAR} pour la substitution parse-time des variables d'env.
# {env.VAR} est un placeholder runtime valide DANS les directives, mais invalide
# pour les adresses de site et le bloc global — il serait traité littéralement,
# provoquant une erreur TLS "subject does not qualify for certificate".
#
# Cause de la panne production confirmée (docker/Caddyfile, 2026-05-25).
#
# Usage : ./scripts/check-caddy-syntax.sh [répertoire]
# Par défaut : ./docker/

set -euo pipefail

SCAN_DIR="${1:-./docker}"
ERRORS=0

mapfile -d '' CADDYFILES < <(find "$SCAN_DIR" \( -name "Caddyfile" -o -name "*.caddyfile" \) -print0 2>/dev/null)
if [ "${#CADDYFILES[@]}" -eq 0 ]; then
  echo "[SKIP] Aucun Caddyfile trouvé dans $SCAN_DIR"
  exit 0
fi

for file in "${CADDYFILES[@]}"; do
  # Rechercher {env.VAR} dans les lignes non-commentaires
  if grep -n '{env\.' "$file" | grep -v '^[0-9]*:[[:space:]]*#' | grep -q .; then
    echo "[FAIL] $file contient {env.VAR} hors commentaire — utiliser {\$VAR} :" >&2
    grep -n '{env\.' "$file" | grep -v '^[0-9]*:[[:space:]]*#' >&2
    ERRORS=$((ERRORS + 1))
  fi
done

if [ "$ERRORS" -gt 0 ]; then
  echo "" >&2
  echo "  → Remplacer {env.VAR} par {\$VAR} dans les adresses de site," >&2
  echo "    le bloc global (email, acme_ca) et les valeurs de directives." >&2
  exit 1
fi

echo "[OK] Aucune syntaxe {env.VAR} incorrecte dans les Caddyfiles."
