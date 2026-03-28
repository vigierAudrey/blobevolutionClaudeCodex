#!/usr/bin/env bash
# check-pre-vps-env.sh — Validation des variables d'env avant démarrage pré-VPS
#
# Usage : source .env.pre-vps && ./scripts/check-pre-vps-env.sh
#   ou   ./scripts/check-pre-vps-env.sh .env.pre-vps
#
# Retourne 0 si tout est OK, 1 si des variables manquent ou sont invalides.

set -euo pipefail

ENV_FILE="${1:-.env.pre-vps}"

# ─── Garde anti-production ────────────────────────────────────────────────────
if [ "${NODE_ENV:-}" = "production" ] && [ "${APP_ENV:-}" != "pre-vps" ]; then
  echo "ABORT: check-pre-vps-env.sh détecte NODE_ENV=production sans APP_ENV=pre-vps." >&2
  echo "       Ce script ne doit pas tourner en production réelle." >&2
  exit 1
fi

# Charger le fichier env si fourni
if [ -f "$ENV_FILE" ]; then
  # Charger sans exécuter les valeurs (lecture seule)
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
else
  echo "WARN: $ENV_FILE introuvable. Variables lues depuis l'environnement actuel." >&2
fi

ERRORS=0

require_var() {
  local var="$1"
  local min_len="${2:-1}"
  local value="${!var:-}"

  if [ -z "$value" ]; then
    echo "MANQUANT  : $var"
    ERRORS=$((ERRORS + 1))
    return
  fi

  if [ "${#value}" -lt "$min_len" ]; then
    echo "TROP COURT: $var (${#value} < $min_len chars)"
    ERRORS=$((ERRORS + 1))
    return
  fi
}

forbidden_value() {
  local var="$1"
  local bad="$2"
  local value="${!var:-}"
  if [ "$value" = "$bad" ]; then
    echo "VALEUR INTERDITE: $var='$bad'"
    ERRORS=$((ERRORS + 1))
  fi
}

echo "=== Validation de l'environnement pré-VPS ==="
echo ""

# ─── Garde env ────────────────────────────────────────────────────────────────
echo "--- Identité d'environnement ---"
require_var "APP_ENV"
if [ "${APP_ENV:-}" != "pre-vps" ]; then
  echo "INVALIDE  : APP_ENV doit valoir 'pre-vps' (valeur actuelle: '${APP_ENV:-}')"
  ERRORS=$((ERRORS + 1))
fi
require_var "NODE_ENV"

# ─── DB ───────────────────────────────────────────────────────────────────────
echo "--- Base de données ---"
require_var "POSTGRES_PASSWORD" 16
forbidden_value "POSTGRES_PASSWORD" "CHANGEME_fort_32chars_minimum"

# ─── Redis ────────────────────────────────────────────────────────────────────
echo "--- Redis ---"
require_var "REDIS_PASSWORD" 16
forbidden_value "REDIS_PASSWORD" "CHANGEME_redis_fort_32chars"

# ─── Secrets auth ─────────────────────────────────────────────────────────────
echo "--- Secrets d'authentification ---"
require_var "SESSION_SECRET" 64
require_var "JWT_SECRET" 64
require_var "JWT_REFRESH_SECRET" 64
require_var "TWO_FACTOR_SECRET" 16
require_var "IP_HASH_SECRET" 16
require_var "CONSENT_WRITE_SECRET" 64
require_var "LOG_ACTOR_SECRET" 64

# Vérifier que les secrets critiques sont distincts
if [ -n "${IP_HASH_SECRET:-}" ] && [ -n "${TWO_FACTOR_SECRET:-}" ]; then
  if [ "${IP_HASH_SECRET}" = "${TWO_FACTOR_SECRET}" ]; then
    echo "COLLISION : IP_HASH_SECRET et TWO_FACTOR_SECRET identiques"
    ERRORS=$((ERRORS + 1))
  fi
fi
if [ -n "${LOG_ACTOR_SECRET:-}" ] && [ -n "${JWT_SECRET:-}" ]; then
  if [ "${LOG_ACTOR_SECRET}" = "${JWT_SECRET}" ]; then
    echo "COLLISION : LOG_ACTOR_SECRET et JWT_SECRET identiques"
    ERRORS=$((ERRORS + 1))
  fi
fi

# ─── Network / CORS ───────────────────────────────────────────────────────────
echo "--- CORS / Proxy ---"
require_var "ALLOWED_ORIGINS"
require_var "TRUST_PROXY_MODE"
if [ "${TRUST_PROXY_MODE:-}" = "ips" ]; then
  require_var "TRUSTED_PROXY_IPS"
fi

# ─── S3 ───────────────────────────────────────────────────────────────────────
echo "--- S3 / MinIO ---"
require_var "S3_ACCESS_KEY_ID"
require_var "S3_SECRET_ACCESS_KEY" 16
require_var "S3_BUCKET"
forbidden_value "S3_SECRET_ACCESS_KEY" "CHANGEME_minio_secret_32chars_minimum"
forbidden_value "S3_ACCESS_KEY_ID" "minioadmin"
forbidden_value "S3_SECRET_ACCESS_KEY" "minioadmin"

# ─── Frontend ─────────────────────────────────────────────────────────────────
echo "--- Frontend ---"
require_var "NEXT_PUBLIC_API_URL"
require_var "WEB_BASE_URL"
require_var "PRIMARY_ADMIN_EMAILS"

# ─── Certs TLS ────────────────────────────────────────────────────────────────
echo "--- TLS / mkcert ---"
CERT_DIR="${MKCERT_CERTS_DIR:-./docker/certs/pre-vps}"
if [ ! -f "${CERT_DIR}/api.blobinfini.local.pem" ]; then
  echo "MANQUANT  : ${CERT_DIR}/api.blobinfini.local.pem (lancer pre-vps-bootstrap.sh)"
  ERRORS=$((ERRORS + 1))
fi
if [ ! -f "${CERT_DIR}/app.blobinfini.local.pem" ]; then
  echo "MANQUANT  : ${CERT_DIR}/app.blobinfini.local.pem (lancer pre-vps-bootstrap.sh)"
  ERRORS=$((ERRORS + 1))
fi

# ─── /etc/hosts ───────────────────────────────────────────────────────────────
echo "--- /etc/hosts ---"
if ! grep -q "api.blobinfini.local" /etc/hosts 2>/dev/null; then
  echo "WARN      : api.blobinfini.local absent de /etc/hosts (voir runbook)"
fi
if ! grep -q "app.blobinfini.local" /etc/hosts 2>/dev/null; then
  echo "WARN      : app.blobinfini.local absent de /etc/hosts (voir runbook)"
fi

echo ""
if [ "$ERRORS" -eq 0 ]; then
  echo "=== OK — Environnement pré-VPS valide ($ERRORS erreur(s)) ==="
  exit 0
else
  echo "=== ÉCHEC — $ERRORS erreur(s) à corriger avant de démarrer ==="
  exit 1
fi
