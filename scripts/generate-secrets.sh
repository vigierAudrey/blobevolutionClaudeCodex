#!/usr/bin/env bash
set -euo pipefail

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl n'est pas installé. Veuillez l'installer pour générer des secrets sécurisés." >&2
  exit 1
fi

generate_secret() {
  openssl rand -base64 64 | tr -d '\n'
}

echo "# Secrets générés – copiez ces valeurs dans votre fichier .env"
echo "SESSION_SECRET=$(generate_secret)"
echo "JWT_SECRET=$(generate_secret)"
echo "JWT_REFRESH_SECRET=$(generate_secret)"
