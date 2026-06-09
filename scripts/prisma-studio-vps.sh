#!/usr/bin/env bash
set -euo pipefail

PORT="${PRISMA_STUDIO_PORT:-5555}"

if [ ! -f ".env.vps" ]; then
  echo "Erreur : .env.vps introuvable à la racine du projet."
  echo "Ce script doit être lancé depuis la racine du projet."
  exit 1
fi

# Charge .env.vps sans afficher les variables
set -a
# shellcheck source=/dev/null
source .env.vps
set +a

if [ -z "${DATABASE_URL:-}" ]; then
  echo "Erreur : DATABASE_URL est absente ou vide dans .env.vps."
  exit 1
fi

echo "Prisma Studio démarre sur 127.0.0.1:${PORT}"
echo ""
echo "Depuis votre machine locale, ouvrez un tunnel SSH :"
echo "  ssh -L ${PORT}:127.0.0.1:${PORT} audrey@<IP_OU_HOST_DU_VPS>"
echo ""
echo "Puis ouvrez dans votre navigateur :"
echo "  http://localhost:${PORT}"
echo ""
echo "Pour arrêter Prisma Studio : Ctrl+C"
echo ""

pnpm --filter @blobinfini/database exec prisma studio \
  --hostname 127.0.0.1 \
  --port "${PORT}" \
  --browser none
