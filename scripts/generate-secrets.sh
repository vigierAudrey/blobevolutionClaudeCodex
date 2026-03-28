#!/usr/bin/env bash
# generate-secrets.sh — Génération de secrets forts pour BlobConnect
#
# Usage :
#   ./scripts/generate-secrets.sh              # Secrets standards (JWT, Session)
#   ./scripts/generate-secrets.sh --pre-vps    # Tous les secrets pré-VPS
#   ./scripts/generate-secrets.sh --all        # Tous les secrets
#
# Output : variables à copier dans .env ou .env.pre-vps

set -euo pipefail

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl n'est pas installé." >&2
  exit 1
fi

gen64() {
  openssl rand -base64 64 | tr -d '\n='
}

gen32() {
  openssl rand -base64 32 | tr -d '\n='
}

MODE="${1:-}"

echo "# Secrets générés le $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "# Copiez ces valeurs dans votre fichier .env ou .env.pre-vps"
echo "# JAMAIS commiter ces secrets dans git"
echo ""

# Secrets présents dans tous les modes
echo "SESSION_SECRET=$(gen64)"
echo "JWT_SECRET=$(gen64)"
echo "JWT_REFRESH_SECRET=$(gen64)"

if [[ "$MODE" == "--pre-vps" || "$MODE" == "--all" ]]; then
  echo "TWO_FACTOR_SECRET=$(gen32)"
  echo "IP_HASH_SECRET=$(gen32)"
  echo "CONSENT_WRITE_SECRET=$(gen64)"
  echo "LOG_ACTOR_SECRET=$(gen64)"
  echo "METRICS_INTERNAL_TOKEN=$(gen32)"
  echo ""
  echo "# Variables DB/Redis (remplir les valeurs CHANGEME)"
  echo "POSTGRES_PASSWORD=$(gen32)"
  echo "REDIS_PASSWORD=$(gen32)"
  echo "S3_SECRET_ACCESS_KEY=$(gen32)"
fi
