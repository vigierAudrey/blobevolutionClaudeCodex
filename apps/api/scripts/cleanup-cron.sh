#!/bin/bash
# Script wrapper pour le cron job de nettoyage des comptes supprimés
# Exécuté quotidiennement par Docker cron

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="${API_DIR}/logs"
LOG_FILE="${LOG_DIR}/cleanup-$(date +%Y-%m-%d).log"

# Créer le répertoire de logs si nécessaire
mkdir -p "$LOG_DIR"

# Logger le début
echo "=====================================" | tee -a "$LOG_FILE"
echo "Cleanup job started: $(date)" | tee -a "$LOG_FILE"
echo "=====================================" | tee -a "$LOG_FILE"

# Exécuter le script TypeScript
cd "$API_DIR"

# Charger les variables d'environnement
if [ -f .env ]; then
  export $(cat .env | grep -v '^#' | xargs)
fi

# Exécuter avec ts-node
npx ts-node "$SCRIPT_DIR/cleanup-deleted-accounts.ts" 2>&1 | tee -a "$LOG_FILE"

EXIT_CODE=${PIPESTATUS[0]}

# Logger la fin
echo "=====================================" | tee -a "$LOG_FILE"
echo "Cleanup job finished: $(date)" | tee -a "$LOG_FILE"
echo "Exit code: $EXIT_CODE" | tee -a "$LOG_FILE"
echo "=====================================" | tee -a "$LOG_FILE"

# Nettoyer les vieux logs (garder 30 jours)
find "$LOG_DIR" -name "cleanup-*.log" -mtime +30 -delete

exit $EXIT_CODE
