#!/bin/bash
# Script pour tester le nettoyage des comptes supprimés en mode DRY-RUN
# Usage: ./scripts/test-cleanup.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(dirname "$SCRIPT_DIR")"

cd "$API_DIR"

echo "🧪 Test du script de nettoyage en mode DRY-RUN"
echo "=============================================="
echo ""
echo "Ce script va simuler le nettoyage sans modifier la base de données."
echo ""

# Charger les variables d'environnement
if [ -f .env ]; then
  export $(cat .env | grep -v '^#' | xargs)
fi

# Exécuter en mode DRY_RUN
export DRY_RUN=true

npx ts-node "$SCRIPT_DIR/cleanup-deleted-accounts.ts"

echo ""
echo "✅ Test terminé. Aucune donnée n'a été modifiée (mode DRY-RUN)."
echo ""
echo "Pour exécuter réellement le nettoyage, utilisez:"
echo "  DRY_RUN=false npx ts-node scripts/cleanup-deleted-accounts.ts"
