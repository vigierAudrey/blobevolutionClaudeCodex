#!/usr/bin/env bash
# guard-caddyfile-xff.sh — Bloque les régressions sur l'injection X-Forwarded-For dans Caddy.
#
# CONTEXTE :
#   {header.X-Forwarded-For} passe en aveugle le header entrant du client.
#   Conséquences :
#     1. IP spoofing : le client contrôle le header → contourne les rate-limiters.
#     2. Rate-limit keys incorrectes : sans XFF client, l'API voit l'IP Docker de Caddy
#        (ex: 172.21.0.7) au lieu de l'IP réelle → toutes les sessions partagent la même clé.
#   Valeur correcte : {remote_host} = IP de la connexion TCP entrante (non altérable).
#
# Ce guard vérifie également que .env.vps.example ne mélange pas les subnets VPS / blobsurf.
#   docker-compose.vps.yml     → réseau 172.21.0.0/16 → TRUSTED_PROXY_IPS=172.21.0.0/16
#   docker-compose.blobsurf.yml → réseau 172.22.0.0/16 → TRUSTED_PROXY_IPS=172.22.0.0/16
#   Inverser les deux = CSRF_NO_SECRET (session cookie non émis car req.secure=false)
#
# Usage : bash scripts/guard-caddyfile-xff.sh   (depuis la racine du repo)
# Exit 0 = OK, exit 1 = violation détectée.

set -euo pipefail

CADDYFILE="docker/Caddyfile"
VPS_EXAMPLE=".env.vps.example"
ERRORS=0

# ── 1. Vérifier l'absence de header_up X-Forwarded-For {header.X-Forwarded-For} ────────

if [ ! -f "$CADDYFILE" ]; then
  echo "ERREUR: $CADDYFILE introuvable (lancer depuis la racine du repo)" >&2
  exit 1
fi

if grep -n 'header_up[[:space:]]*X-Forwarded-For[[:space:]]*{header\.X-Forwarded-For}' "$CADDYFILE"; then
  echo "" >&2
  echo "GUARD FAIL: $CADDYFILE utilise {header.X-Forwarded-For} dans header_up." >&2
  echo "  Ce placeholder passe le header client en aveugle → IP spoofing possible." >&2
  echo "  Corriger : remplacer {header.X-Forwarded-For} par {remote_host}." >&2
  ERRORS=$((ERRORS + 1))
fi

# ── 2. Vérifier que .env.vps.example pointe sur le bon subnet VPS ────────────────────

if [ -f "$VPS_EXAMPLE" ]; then
  # Le subnet VPS est 172.21.0.0/16 (docker-compose.vps.yml).
  # 172.22.0.0/16 est le subnet blobsurf (docker-compose.blobsurf.yml) — confusion interdite.
  if grep -n 'TRUSTED_PROXY_IPS=172\.22\.' "$VPS_EXAMPLE"; then
    echo "" >&2
    echo "GUARD FAIL: $VPS_EXAMPLE référence le subnet blobsurf (172.22.x.x) pour TRUSTED_PROXY_IPS." >&2
    echo "  docker-compose.vps.yml utilise 172.21.0.0/16 → TRUSTED_PROXY_IPS=172.21.0.0/16." >&2
    echo "  172.22.0.0/16 est réservé à docker-compose.blobsurf.yml." >&2
    ERRORS=$((ERRORS + 1))
  fi
fi

if [ "$ERRORS" -eq 0 ]; then
  echo "GUARD OK: Caddyfile XFF correct ({remote_host}) et subnet VPS cohérent."
  exit 0
else
  echo "" >&2
  echo "GUARD FAIL: $ERRORS violation(s) détectée(s)." >&2
  exit 1
fi
