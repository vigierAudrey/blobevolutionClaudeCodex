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
require_var "EMAIL_HASH_SECRET" 16
forbidden_value "EMAIL_HASH_SECRET" "CHANGEME_email_hash_secret_32chars_minimum_xxxxxxxxxx_different_from_ip"
require_var "CONSENT_WRITE_SECRET" 64
require_var "LOG_ACTOR_SECRET" 64

# Vérifier que les secrets critiques sont distincts
if [ -n "${IP_HASH_SECRET:-}" ] && [ -n "${TWO_FACTOR_SECRET:-}" ]; then
  if [ "${IP_HASH_SECRET}" = "${TWO_FACTOR_SECRET}" ]; then
    echo "COLLISION : IP_HASH_SECRET et TWO_FACTOR_SECRET identiques"
    ERRORS=$((ERRORS + 1))
  fi
fi
if [ -n "${EMAIL_HASH_SECRET:-}" ] && [ -n "${IP_HASH_SECRET:-}" ]; then
  if [ "${EMAIL_HASH_SECRET}" = "${IP_HASH_SECRET}" ]; then
    echo "COLLISION : EMAIL_HASH_SECRET et IP_HASH_SECRET identiques"
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

# ─── Observabilité ────────────────────────────────────────────────────────────
# METRICS_INTERNAL_TOKEN : smoke test l'utilise pour /internal/metrics (X-Internal-Token).
require_var "METRICS_INTERNAL_TOKEN" 16
forbidden_value "METRICS_INTERNAL_TOKEN" "CHANGEME_metrics_token_32chars_minimum"
# SECURITY_MONITOR_TOKEN : smoke test l'utilise pour /security/health (X-Security-Monitor-Token).
# Header distinct de METRICS_INTERNAL_TOKEN — ne pas confondre.
require_var "SECURITY_MONITOR_TOKEN" 16
forbidden_value "SECURITY_MONITOR_TOKEN" "CHANGEME_security_monitor_token_32chars"

# ─── GDPR ─────────────────────────────────────────────────────────────────────
echo "--- GDPR ---"
# ANONYMIZATION_SALT : hachage RGPD dans booking-archive.ts et gdpr-purge.service.ts.
# Fallback insécure 'blobinfini-gdpr-salt' si absent — toujours définir explicitement.
require_var "ANONYMIZATION_SALT" 16
forbidden_value "ANONYMIZATION_SALT" "CHANGEME_gdpr_anonymization_salt_32chars_xxxxxxxxxx"
forbidden_value "ANONYMIZATION_SALT" "blobinfini-gdpr-salt"

# ─── Frontend ─────────────────────────────────────────────────────────────────
echo "--- Frontend ---"
require_var "NEXT_PUBLIC_API_URL"
require_var "WEB_BASE_URL"
require_var "PRIMARY_ADMIN_EMAILS"

# ─── Firebase push (validé uniquement si la feature est activée) ──────────────
# Garde-fou ops : si PUSH_NOTIFICATIONS_ENABLED=true, la config Firebase doit être
# réelle (projet de TEST), cohérente front/API, et SANS placeholder demo. Sinon le
# staging part en vrille (token pour un projet A, envoi Admin via un projet B, ou
# fail-closed silencieux). Aucune valeur n'est jamais affichée : seules les variables
# en faute sont nommées.
echo "--- Firebase push (PUSH_NOTIFICATIONS_ENABLED) ---"
if [ "${PUSH_NOTIFICATIONS_ENABLED:-false}" = "true" ]; then
  echo "INFO      : PUSH_NOTIFICATIONS_ENABLED=true → validation stricte de la config Firebase"

  # Rejette tout placeholder demo (substring 'demo' ou sentinelle '123456789'),
  # aligné avec DEMO_FIREBASE_VALUES côté front (apps/web/lib/firebase.ts).
  # N'affiche jamais la valeur, seulement le nom de variable.
  reject_fb_demo() {
    local var="$1"
    local value="${!var:-}"
    if [ -n "$value" ]; then
      case "$value" in
        *demo*|*123456789*)
          echo "VALEUR DEMO INTERDITE: $var (placeholder demo non autorisé avec push ON)"
          ERRORS=$((ERRORS + 1)) ;;
      esac
    fi
  }

  # Secrets serveur (API Admin) — require_var/échecs ne montrent jamais la valeur
  require_var "FIREBASE_PROJECT_ID"
  reject_fb_demo "FIREBASE_PROJECT_ID"
  require_var "FIREBASE_CLIENT_EMAIL"
  require_var "FIREBASE_PRIVATE_KEY" 40
  if [ -n "${FIREBASE_PRIVATE_KEY:-}" ]; then
    case "${FIREBASE_PRIVATE_KEY}" in
      *"BEGIN PRIVATE KEY"*) : ;;
      *)
        echo "INVALIDE  : FIREBASE_PRIVATE_KEY ne ressemble pas à une clé privée PEM"
        ERRORS=$((ERRORS + 1)) ;;
    esac
  fi

  # Config publique front (NEXT_PUBLIC_*) — publiques mais doivent être réelles
  require_var "NEXT_PUBLIC_FIREBASE_API_KEY"
  reject_fb_demo "NEXT_PUBLIC_FIREBASE_API_KEY"
  require_var "NEXT_PUBLIC_FIREBASE_PROJECT_ID"
  reject_fb_demo "NEXT_PUBLIC_FIREBASE_PROJECT_ID"
  require_var "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID"
  reject_fb_demo "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID"
  require_var "NEXT_PUBLIC_FIREBASE_APP_ID"
  reject_fb_demo "NEXT_PUBLIC_FIREBASE_APP_ID"
  require_var "NEXT_PUBLIC_FIREBASE_VAPID_KEY"
  reject_fb_demo "NEXT_PUBLIC_FIREBASE_VAPID_KEY"

  # Cohérence projet front/API : sinon token généré pour le projet front, mais
  # envoi Admin via un autre projet → staging incompréhensible.
  if [ -n "${NEXT_PUBLIC_FIREBASE_PROJECT_ID:-}" ] && [ -n "${FIREBASE_PROJECT_ID:-}" ] \
     && [ "${NEXT_PUBLIC_FIREBASE_PROJECT_ID}" != "${FIREBASE_PROJECT_ID}" ]; then
    echo "INCOHERENT: NEXT_PUBLIC_FIREBASE_PROJECT_ID != FIREBASE_PROJECT_ID (front et API doivent viser le même projet Firebase)"
    ERRORS=$((ERRORS + 1))
  fi
else
  echo "WARN      : PUSH_NOTIFICATIONS_ENABLED!=true → validation Firebase ignorée (push OFF, OK)"
fi

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
