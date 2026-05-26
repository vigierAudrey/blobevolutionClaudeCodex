#!/usr/bin/env bash
# check-vps-env.sh — Validation des variables d'env avant démarrage VPS
#
# Usage : ./scripts/check-vps-env.sh .env.vps
#
# Retourne 0 si tout est OK, 1 si des variables manquent ou sont invalides.
#
# Vérifications supplémentaires par rapport à check-pre-vps-env.sh :
#   - APP_ENV=vps (pas pre-vps)
#   - S3_PRESIGN_ENDPOINT ne contient PAS localhost (cassant sur VPS réel)
#   - S3_PUBLIC_URL_BASE ne contient PAS localhost (idem)
#   - STORAGE_DOMAIN défini et non-localhost (si utilisé)
#   - SMTP Brevo obligatoire, authentifié, sans fallback Mailpit
#   - Certs VPS présents pour les 3 domaines (api, app, storage)

set -euo pipefail

ENV_FILE="${1:-.env.vps}"

log_err() { echo "ERREUR    : $*"; }
log_warn() { echo "WARN      : $*"; }
log_ok()  { echo "OK        : $*"; }

ERRORS=0

require_var() {
  local var="$1"
  local min_len="${2:-1}"
  local value="${!var:-}"

  if [ -z "$value" ]; then
    log_err "$var manquant"
    ERRORS=$((ERRORS + 1))
    return
  fi

  if [ "${#value}" -lt "$min_len" ]; then
    log_err "$var trop court (${#value} < $min_len chars)"
    ERRORS=$((ERRORS + 1))
    return
  fi
}

forbidden_value() {
  local var="$1"
  local bad="$2"
  local value="${!var:-}"
  if [ "$value" = "$bad" ]; then
    log_err "Valeur interdite : $var='$bad'"
    ERRORS=$((ERRORS + 1))
  fi
}

must_not_contain() {
  local var="$1"
  local needle="$2"
  local value="${!var:-}"
  if echo "$value" | grep -qi "$needle" 2>/dev/null; then
    log_err "$var contient '$needle' — invalide en VPS réel (valeur: $value)"
    ERRORS=$((ERRORS + 1))
  fi
}

must_start_with() {
  local var="$1"
  local prefix="$2"
  local value="${!var:-}"
  if [ -n "$value" ] && ! echo "$value" | grep -q "^$prefix" 2>/dev/null; then
    log_err "$var doit commencer par '$prefix' (valeur: $value)"
    ERRORS=$((ERRORS + 1))
  fi
}

# Charger le fichier env si fourni
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
else
  echo "WARN: $ENV_FILE introuvable. Variables lues depuis l'environnement actuel." >&2
fi

echo "=== Validation de l'environnement VPS ==="
echo ""

# ─── Identité d'environnement ─────────────────────────────────────────────────
echo "--- Identité ---"
require_var "APP_ENV"
if [ "${APP_ENV:-}" != "vps" ]; then
  log_err "APP_ENV doit valoir 'vps' (valeur actuelle: '${APP_ENV:-}')"
  echo "       (Si vous ciblez le pré-VPS, utilisez check-pre-vps-env.sh)"
  ERRORS=$((ERRORS + 1))
else
  log_ok "APP_ENV=vps"
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

if [ -n "${IP_HASH_SECRET:-}" ] && [ -n "${TWO_FACTOR_SECRET:-}" ]; then
  if [ "${IP_HASH_SECRET}" = "${TWO_FACTOR_SECRET}" ]; then
    log_err "IP_HASH_SECRET et TWO_FACTOR_SECRET identiques"
    ERRORS=$((ERRORS + 1))
  fi
fi
if [ -n "${LOG_ACTOR_SECRET:-}" ] && [ -n "${JWT_SECRET:-}" ]; then
  if [ "${LOG_ACTOR_SECRET}" = "${JWT_SECRET}" ]; then
    log_err "LOG_ACTOR_SECRET et JWT_SECRET identiques"
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

# ─── S3 / MinIO — VÉRIFICATIONS CRITIQUES VPS ────────────────────────────────
echo "--- S3 / MinIO ---"
require_var "S3_ACCESS_KEY_ID"
require_var "S3_SECRET_ACCESS_KEY" 16
require_var "S3_BUCKET"
forbidden_value "S3_SECRET_ACCESS_KEY" "CHANGEME_minio_secret_32chars_minimum"
forbidden_value "S3_ACCESS_KEY_ID" "minioadmin"
forbidden_value "S3_ACCESS_KEY_ID" "pvps-access-key"
forbidden_value "S3_SECRET_ACCESS_KEY" "minioadmin"

# STORAGE_DOMAIN : obligatoire, non-localhost, non-hostname-docker-interne
require_var "STORAGE_DOMAIN"
must_not_contain "STORAGE_DOMAIN" "localhost"
must_not_contain "STORAGE_DOMAIN" "127\.0\.0\."
must_not_contain "STORAGE_DOMAIN" "0\.0\.0\.0"
must_not_contain "STORAGE_DOMAIN" "::1"
must_not_contain "STORAGE_DOMAIN" "minio"
must_not_contain "STORAGE_DOMAIN" "api"
must_not_contain "STORAGE_DOMAIN" "web"
must_not_contain "STORAGE_DOMAIN" "postgres"
# Rejeter si la valeur contient "://" (protocole fourni par erreur)
if echo "${STORAGE_DOMAIN:-}" | grep -q "://"; then
  log_err "STORAGE_DOMAIN ne doit pas contenir le protocole (fournir seulement le domaine, ex: storage.blobinfini.fr)"
  ERRORS=$((ERRORS + 1))
elif [ -n "${STORAGE_DOMAIN:-}" ]; then
  log_ok "STORAGE_DOMAIN=${STORAGE_DOMAIN}"
fi
# Note: STORAGE_DOMAIN vide est déjà compté par require_var ci-dessus → ERRORS++

# S3_PRESIGN_ENDPOINT : si défini directement (hors override compose), ne doit pas contenir localhost
if [ -n "${S3_PRESIGN_ENDPOINT:-}" ]; then
  must_not_contain "S3_PRESIGN_ENDPOINT" "localhost"
  must_not_contain "S3_PRESIGN_ENDPOINT" "127\.0\.0\."
  must_start_with "S3_PRESIGN_ENDPOINT" "https://"
  log_ok "S3_PRESIGN_ENDPOINT=${S3_PRESIGN_ENDPOINT}"
else
  log_ok "S3_PRESIGN_ENDPOINT non défini ici — sera injecté par docker-compose.vps.yml depuis STORAGE_DOMAIN"
fi

# S3_PUBLIC_URL_BASE : idem
if [ -n "${S3_PUBLIC_URL_BASE:-}" ]; then
  must_not_contain "S3_PUBLIC_URL_BASE" "localhost"
  must_not_contain "S3_PUBLIC_URL_BASE" "127\.0\.0\."
  must_start_with "S3_PUBLIC_URL_BASE" "https://"
  log_ok "S3_PUBLIC_URL_BASE=${S3_PUBLIC_URL_BASE}"
else
  log_ok "S3_PUBLIC_URL_BASE non défini ici — sera injecté par docker-compose.vps.yml"
fi

# ─── Observabilité ────────────────────────────────────────────────────────────
echo "--- Observabilité ---"
require_var "METRICS_INTERNAL_TOKEN" 16
forbidden_value "METRICS_INTERNAL_TOKEN" "CHANGEME_metrics_token_32chars_minimum"
require_var "SECURITY_MONITOR_TOKEN" 16
forbidden_value "SECURITY_MONITOR_TOKEN" "CHANGEME_security_monitor_token_32chars"

# ─── SMTP / Brevo ─────────────────────────────────────────────────────────────
echo "--- SMTP / Brevo ---"
require_var "SMTP_HOST"
require_var "SMTP_PORT"
require_var "SMTP_USER"
require_var "SMTP_PASS" 8
require_var "SMTP_FROM"
require_var "SMTP_SECURE"
if [ "${SMTP_HOST:-}" != "smtp-relay.brevo.com" ]; then
  log_err "SMTP_HOST doit valoir 'smtp-relay.brevo.com' en VPS (valeur actuelle: ${SMTP_HOST:-<vide>})"
  ERRORS=$((ERRORS + 1))
fi
if [ "${SMTP_PORT:-}" != "587" ] && [ "${SMTP_PORT:-}" != "465" ]; then
  log_err "SMTP_PORT doit valoir 587 ou 465 en VPS (valeur actuelle: ${SMTP_PORT:-<vide>})"
  ERRORS=$((ERRORS + 1))
fi
if [ "${SMTP_ALLOW_NO_AUTH:-}" = "true" ] || [ "${SMTP_ALLOW_NO_AUTH:-}" = "1" ]; then
  log_err "SMTP_ALLOW_NO_AUTH ne doit jamais être activé en VPS"
  ERRORS=$((ERRORS + 1))
fi
if [ "${SMTP_PORT:-}" = "465" ] && [ "${SMTP_SECURE:-}" != "true" ]; then
  log_err "SMTP_SECURE doit valoir true quand SMTP_PORT=465"
  ERRORS=$((ERRORS + 1))
fi
if [ "${SMTP_PORT:-}" = "587" ] && [ "${SMTP_SECURE:-}" != "false" ]; then
  log_err "SMTP_SECURE doit valoir false quand SMTP_PORT=587"
  ERRORS=$((ERRORS + 1))
fi
must_not_contain "SMTP_HOST" "^mailpit$"
must_not_contain "SMTP_HOST" "^localhost$"
must_not_contain "SMTP_HOST" "^127\\.0\\.0\\.1$"

# ─── Frontend ─────────────────────────────────────────────────────────────────
echo "--- Frontend ---"
require_var "NEXT_PUBLIC_API_URL"
require_var "WEB_BASE_URL"
require_var "PRIMARY_ADMIN_EMAILS"

# ─── Caddy ACME (stack blobsurf — docker-compose.blobsurf.yml) ───────────────
echo "--- Caddy ACME ---"
if [ -n "${CADDY_ACME_EMAIL:-}" ]; then
  if echo "${CADDY_ACME_EMAIL}" | grep -qP "^[^@\s]+@[^@\s]+\.[^@\s]+$" 2>/dev/null || \
     echo "${CADDY_ACME_EMAIL}" | grep -qE "^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$"; then
    log_ok "CADDY_ACME_EMAIL=${CADDY_ACME_EMAIL}"
  else
    log_err "CADDY_ACME_EMAIL ne ressemble pas à un email valide : ${CADDY_ACME_EMAIL}"
    ERRORS=$((ERRORS + 1))
  fi
  forbidden_value "CADDY_ACME_EMAIL" "contact@blobinfini.local"
else
  # CADDY_ACME_EMAIL optionnel : uniquement requis pour docker-compose.blobsurf.yml.
  # Avec docker-compose.vps.yml (nginx), les certs sont gérés par mkcert/certbot.
  log_ok "CADDY_ACME_EMAIL non défini (optionnel — requis uniquement pour stack Caddy/blobsurf)"
fi

# ─── Certs TLS VPS (nginx — docker-compose.vps.yml) ──────────────────────────
# Ce check ne s'applique qu'à la stack nginx (docker-compose.vps.yml).
# Pour la stack Caddy (docker-compose.blobsurf.yml), Caddy gère les certs automatiquement.
echo "--- TLS (certs VPS nginx) ---"
if [ -n "${CADDY_ACME_EMAIL:-}" ]; then
  log_ok "Stack Caddy détectée (CADDY_ACME_EMAIL défini) — check certs mkcert ignoré"
else
  CERT_DIR="${VPS_CERTS_DIR:-./docker/certs/vps}"
  DOMAIN="${API_DOMAIN:-api.blobinfini.local}"
  STORAGE_DOMAIN_CERT="${STORAGE_DOMAIN:-storage.blobinfini.local}"
  APP_DOMAIN_CERT="${APP_DOMAIN:-app.blobinfini.local}"

  for cert_domain in "$DOMAIN" "$APP_DOMAIN_CERT" "$STORAGE_DOMAIN_CERT"; do
    if [ ! -f "${CERT_DIR}/${cert_domain}.pem" ]; then
      log_err "Cert manquant : ${CERT_DIR}/${cert_domain}.pem (lancer vps-bootstrap.sh)"
      ERRORS=$((ERRORS + 1))
    else
      log_ok "Cert présent : ${cert_domain}.pem"
    fi
  done
fi

echo ""
if [ "$ERRORS" -eq 0 ]; then
  echo "=== OK — Environnement VPS valide ($ERRORS erreur(s)) ==="
  exit 0
else
  echo "=== ÉCHEC — $ERRORS erreur(s) à corriger avant de démarrer ==="
  exit 1
fi
