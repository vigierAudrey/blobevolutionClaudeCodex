#!/usr/bin/env bash
# guard-no-nginx-vps.sh — Bloque docker-compose.vps.yml si nginx:* est référencé.
#
# Caddy est le reverse proxy officiel de la stack VPS (docker-compose.vps.yml).
# nginx:alpine ne doit plus apparaître dans ce fichier — il appartient uniquement
# à docker-compose.pre-vps.yml (environnement local pré-prod avec mkcert).
#
# Usage : bash scripts/guard-no-nginx-vps.sh   (depuis la racine du repo)
# Exit 0 = OK, exit 1 = violation détectée.

set -euo pipefail

FILE="docker-compose.vps.yml"

if [ ! -f "$FILE" ]; then
  echo "ERREUR: $FILE introuvable (lancer depuis la racine du repo)" >&2
  exit 1
fi

# Cherche toute ligne "image: nginx" (inclut nginx:alpine, nginx:1.x, nginx:latest…)
# -n : affiche les numéros de ligne pour faciliter le diagnostic
if grep -n 'image:[[:space:]]*nginx' "$FILE"; then
  echo "" >&2
  echo "GUARD FAIL: $FILE référence une image nginx." >&2
  echo "  Caddy (caddy:2-alpine) est le reverse proxy officiel pour la stack VPS." >&2
  echo "  nginx appartient uniquement à docker-compose.pre-vps.yml (mkcert local)." >&2
  echo "  Corriger : remplacer le service nginx par le service caddy dans $FILE." >&2
  exit 1
fi

echo "GUARD OK: $FILE ne référence pas nginx — Caddy est en place."
