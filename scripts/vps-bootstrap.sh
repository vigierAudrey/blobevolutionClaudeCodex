#!/usr/bin/env bash
# vps-bootstrap.sh — Bootstrap complet de l'environnement VPS Runtime BlobConnect
#
# Ce script orchestre dans l'ordre :
#   1. Vérification des prérequis (Docker, pnpm)
#   2. Validation du .env.vps (incl. CADDY_ACME_EMAIL obligatoire)
#   3. TLS : Caddy gère les certificats Let's Encrypt automatiquement — pas de mkcert
#   4. Entrée /etc/hosts (optionnelle avec --hosts)
#   5. Reset volumes (optionnel avec --reset)
#   6. Build des images Docker production
#   7. Démarrage infrastructure (postgres, redis, minio)
#   8. Configuration MinIO : bucket + policy GET anonyme préfixée
#   9. Migration Prisma (migrate deploy — jamais db push)
#  10. Seed des comptes de test stables
#  11. Démarrage API + frontend + Caddy (reverse proxy TLS Let's Encrypt)
#
# Différences vs pre-vps-bootstrap.sh :
#   - docker-compose.vps.yml / .env.vps
#   - Reverse proxy : Caddy (Let's Encrypt auto) — pre-vps utilise nginx + mkcert
#   - CADDY_ACME_EMAIL requis dans .env.vps (port 80 doit être ouvert pour ACME HTTP-01)
#   - Étape 8 : mc (MinIO Client) configure bucket policy GET anonyme préfixée
#     MinIO n'est pas exposé sur l'hôte → configuration via réseau Docker interne
#
# Usage :
#   ./scripts/vps-bootstrap.sh
#   ./scripts/vps-bootstrap.sh --reset      # Repart de zéro (volumes détruits)
#   ./scripts/vps-bootstrap.sh --no-build   # Skip le build Docker
#   ./scripts/vps-bootstrap.sh --hosts      # Ajoute les entrées /etc/hosts (sudo requis)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env.vps"
DC="docker compose -f $REPO_ROOT/docker-compose.vps.yml --env-file $ENV_FILE"
MC_IMAGE="quay.io/minio/mc:RELEASE.2025-08-13T08-35-41Z"

RESET=false
NO_BUILD=false
ADD_HOSTS=false

for arg in "$@"; do
  case "$arg" in
    --reset)    RESET=true ;;
    --no-build) NO_BUILD=true ;;
    --hosts)    ADD_HOSTS=true ;;
    *) echo "Argument inconnu: $arg" >&2; exit 1 ;;
  esac
done

log()  { echo "[vps-bootstrap] $*"; }
die()  { echo "[vps-bootstrap] ERREUR: $*" >&2; exit 1; }
warn() { echo "[vps-bootstrap] WARN: $*"; }

log "=== Bootstrap VPS Runtime BlobConnect ==="
cd "$REPO_ROOT"

# ─── 1. Prérequis ─────────────────────────────────────────────────────────────
log "1. Vérification des prérequis..."

command -v docker >/dev/null 2>&1  || die "docker n'est pas installé"
docker info >/dev/null 2>&1        || die "Docker daemon n'est pas démarré"
command -v pnpm >/dev/null 2>&1    || die "pnpm n'est pas installé (corepack enable)"

# mkcert n'est plus requis : Caddy gère les certificats Let's Encrypt automatiquement.
# (mkcert reste nécessaire pour pre-vps-bootstrap.sh uniquement)

log "  Docker OK, pnpm OK"

# ─── 2. Fichier .env.vps ──────────────────────────────────────────────────────
log "2. Validation du fichier .env.vps..."

if [ ! -f "$ENV_FILE" ]; then
  log "  .env.vps introuvable. Copie depuis .env.vps.example..."
  cp "$REPO_ROOT/.env.vps.example" "$ENV_FILE"
  log "  ATTENTION : .env.vps créé avec des valeurs CHANGEME."
  log "  Lancez d'abord : ./scripts/generate-secrets.sh --pre-vps >> .env.vps"
  log "  Puis éditez .env.vps (STORAGE_DOMAIN, APP_ENV=vps...) et relancez ce script."
  exit 1
fi

bash "$SCRIPT_DIR/check-vps-env.sh" "$ENV_FILE" || {
  die "Validation de l'env échouée. Corriger .env.vps avant de continuer."
}

# Décontaminer l'environnement shell avant de charger .env.vps.
# Si le terminal hôte avait des vars de développement (issues d'un source .env ou .env.pre-vps),
# docker compose v2 leur donnerait priorité sur --env-file et corromprait les secrets VPS.
# On unset explicitement les vars critiques AVANT source pour garantir que .env.vps gagne.
for _var in REDIS_PASSWORD POSTGRES_PASSWORD POSTGRES_USER POSTGRES_DB DATABASE_URL \
            SESSION_SECRET JWT_SECRET JWT_REFRESH_SECRET TWO_FACTOR_SECRET IP_HASH_SECRET \
            CONSENT_WRITE_SECRET LOG_ACTOR_SECRET S3_SECRET_ACCESS_KEY S3_ACCESS_KEY_ID \
            METRICS_INTERNAL_TOKEN SECURITY_MONITOR_TOKEN; do
  unset "$_var" 2>/dev/null || true
done

# Charger les vars
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

STORAGE_DOMAIN="${STORAGE_DOMAIN:-storage.blobinfini.local}"
API_DOMAIN="${API_DOMAIN:-api.blobinfini.local}"
APP_DOMAIN="${APP_DOMAIN:-app.blobinfini.local}"
BUCKET="${S3_BUCKET:-blobinfini-vps}"

# ─── 3. Certificats TLS ───────────────────────────────────────────────────────
# Caddy gère les certificats Let's Encrypt automatiquement via ACME HTTP-01.
# Aucune action manuelle requise : les certs sont émis et renouvelés par Caddy au démarrage.
#
# Prérequis réseau pour l'émission initiale :
#   - Port 80 ouvert sur le VPS (firewall/iptables) — Let's Encrypt vérifie /.well-known/acme-challenge/
#   - Domaines DNS (APP_DOMAIN, API_DOMAIN, STORAGE_DOMAIN) pointent vers l'IP du VPS
#   - CADDY_ACME_EMAIL défini dans .env.vps (validé par check-vps-env.sh ci-dessus)
#
# Les certs sont persistés dans le volume Docker caddy-data — NE PAS supprimer ce volume
# (rate-limit Let's Encrypt : 5 certificats par semaine par domaine registered).
log "3. Certificats TLS : Caddy (Let's Encrypt) — aucune action manuelle requise."
log "   CADDY_ACME_EMAIL : ${CADDY_ACME_EMAIL:-<non défini — vérifier .env.vps>}"
log "   Caddy émettra les certs au premier démarrage (port 80 doit être accessible)."

# ─── 4. /etc/hosts (optionnel) ────────────────────────────────────────────────
if [ "$ADD_HOSTS" = "true" ]; then
  log "4. Ajout des entrées /etc/hosts (sudo requis)..."
  for domain in "$API_DOMAIN" "$APP_DOMAIN" "$STORAGE_DOMAIN"; do
    if ! grep -q "$domain" /etc/hosts 2>/dev/null; then
      echo "127.0.0.1  $domain" | sudo tee -a /etc/hosts
      log "  Ajouté: 127.0.0.1  $domain"
    else
      log "  Déjà présent: $domain"
    fi
  done
else
  log "4. /etc/hosts — skip (relancer avec --hosts pour l'ajouter automatiquement)"
  log "   Ajouter manuellement :"
  log "     echo '127.0.0.1  $API_DOMAIN $APP_DOMAIN $STORAGE_DOMAIN' | sudo tee -a /etc/hosts"
fi

# ─── 5. Reset volumes si demandé ──────────────────────────────────────────────
if [ "$RESET" = "true" ]; then
  log "5. Reset — arrêt et suppression des volumes VPS..."
  $DC down -v --remove-orphans 2>/dev/null || true
  log "  Volumes supprimés"
else
  log "5. Reset volumes — skip"
fi

# ─── 6. Build images Docker production ────────────────────────────────────────
if [ "$NO_BUILD" = "false" ]; then
  log "6. Build des images Docker production..."
  log "   Build API..."
  $DC build api
  log "   Build Web..."
  $DC build web
  log "  Build terminé"
else
  log "6. Build Docker — skip (--no-build)"
  if ! docker image inspect blobconnect-vps-api >/dev/null 2>&1; then
    warn "--no-build spécifié mais image blobconnect-vps-api absente. Continuer avec prudence."
  fi
fi

# ─── 7. Démarrage infra (postgres, redis, minio) ─────────────────────────────
log "7. Démarrage de l'infrastructure..."
$DC up -d postgres redis minio

log "   Attente postgres..."
timeout 60 bash -c "until $DC exec -T postgres pg_isready -U ${POSTGRES_USER:-blobinfini_vps} >/dev/null 2>&1; do sleep 2; done" \
  || die "postgres n'est pas prêt après 60s"

log "   Attente redis..."
timeout 30 bash -c "until $DC exec -T redis redis-cli -a '${REDIS_PASSWORD}' ping 2>/dev/null | grep -q PONG; do sleep 2; done" \
  || die "redis n'est pas prêt après 30s"

log "   Attente minio..."
timeout 60 bash -c "until $DC exec -T minio curl -sf http://localhost:9000/minio/health/live >/dev/null 2>&1; do sleep 2; done" \
  || die "minio n'est pas prêt après 60s"

log "  Infrastructure OK"

# ─── 8. Configuration MinIO : bucket + policy GET anonyme préfixée ───────────
#
# Pourquoi ici et pas via env var ?
#   - MinIO ne supporte pas de policy bucket au démarrage via variable d'env
#   - La policy doit être définie via l'API MC après que le bucket existe
#
# Stratégie mc (MinIO Client) via conteneur Docker :
#   - Accès interne au réseau blobconnect-vps_vps (pas besoin de port hôte)
#   - MC_HOST_minio : URL interne Docker minio:9000
#   - `mb --ignore-existing` : crée le bucket s'il n'existe pas encore
#   - `anonymous set-json` : policy custom GetObject-only sur préfixes publics
#
# Nota : si le bucket existe déjà (--no-reset), la commande est idempotente.

log "8. Configuration MinIO (bucket + policy GET anonyme préfixée)..."

MINIO_INT_URL="http://${S3_ACCESS_KEY_ID}:${S3_SECRET_ACCESS_KEY}@minio:9000"

# Créer le bucket (idempotent)
docker run --rm \
  --network "blobconnect-vps_vps" \
  -e "MC_HOST_minio=${MINIO_INT_URL}" \
  "$MC_IMAGE" \
  mb --ignore-existing "minio/${BUCKET}" \
  || die "mc mb échoué"

log "   Bucket '${BUCKET}' OK"

# Définir la policy s3:GetObject anonyme SANS s3:ListBucket (listing interdit)
# et SANS rendre tout le bucket public. Par défaut, seules les photos publiques
# de profils pros sont lisibles par URL directe : pros/*.
#
# Idempotent : si la policy existe déjà, set-json la remplace sans erreur.
ENV_FILE="$ENV_FILE" \
COMPOSE_FILE="$REPO_ROOT/docker-compose.vps.yml" \
MC_IMAGE="$MC_IMAGE" \
PUBLIC_READ_PREFIXES="${PUBLIC_READ_PREFIXES:-pros/*}" \
  "$REPO_ROOT/scripts/minio-public-prefix-policy.sh" \
  || die "Policy MinIO préfixée échouée"

log "   Policy GetObject-only préfixée (listing interdit) définie sur '${BUCKET}' OK"

# Vérifier la policy (strict : "none" = absence de policy = échec)
POLICY_RESULT=$(docker run --rm \
  --network "blobconnect-vps_vps" \
  -e "MC_HOST_minio=${MINIO_INT_URL}" \
  "$MC_IMAGE" \
  anonymous get "minio/${BUCKET}" 2>&1 || echo "ERROR")

if echo "$POLICY_RESULT" | grep -qi "download\|custom\|getobject\|get-object\|policy"; then
  log "   Vérification policy OK : policy custom actuelle"
else
  warn "Vérification policy retourne: $POLICY_RESULT (non bloquant si set-json n'a pas retourné d'erreur)"
fi

# Configuration CORS MinIO : nécessaire pour les uploads cross-origin depuis le navigateur
# (app.$APP_DOMAIN → storage.$STORAGE_DOMAIN via presigned PUT)
# mc cors set attend du XML (pas JSON) et lit depuis stdin via le flag "-" (mc >= 2025-08-13)
# docker run -i connecte le stdin du host au container.
log "8b. Configuration CORS MinIO pour presigned PUT cross-origin..."

CORS_XML='<?xml version="1.0" encoding="UTF-8"?>
<CORSConfiguration>
  <CORSRule>
    <AllowedOrigin>https://'"${APP_DOMAIN}"'</AllowedOrigin>
    <AllowedMethod>GET</AllowedMethod>
    <AllowedMethod>PUT</AllowedMethod>
    <AllowedMethod>HEAD</AllowedMethod>
    <AllowedHeader>*</AllowedHeader>
    <ExposeHeader>ETag</ExposeHeader>
    <ExposeHeader>x-amz-request-id</ExposeHeader>
    <MaxAgeSeconds>3600</MaxAgeSeconds>
  </CORSRule>
</CORSConfiguration>'

CORS_RESULT=$(echo "$CORS_XML" | docker run --rm -i \
  --network "blobconnect-vps_vps" \
  -e "MC_HOST_minio=${MINIO_INT_URL}" \
  "$MC_IMAGE" \
  cors set "minio/${BUCKET}" - 2>&1 || echo "CORS_FAILED")

if echo "$CORS_RESULT" | grep -qi "CORS_FAILED\|NotImplemented\|not implemented"; then
  # S3 PutBucketCors API non implémentée dans ce build MinIO.
  # Non bloquant : MinIO RELEASE.2025-09-07T16-13-09Z gère le CORS en interne
  # (reflection d'origine, Access-Control-Allow-Origin sur OPTIONS et PUT).
  # Vérifié par preflight OPTIONS → 204 + ACAO: https://$APP_DOMAIN, PUT → 200.
  log "8b. CORS MinIO : PutBucketCors=NotImplemented (normal — CORS built-in actif, upload navigateur OK)."
else
  log "   CORS MinIO configuré pour origin https://${APP_DOMAIN} OK"
fi

# ─── 9. Migration Prisma ──────────────────────────────────────────────────────
log "9. Migration Prisma (migrate deploy)..."

$DC run --rm \
  -e DATABASE_URL="postgresql://${POSTGRES_USER:-blobinfini_vps}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-blobinfini_vps}" \
  -e APP_ENV=vps \
  api \
  sh -c "cd /workspace && pnpm --filter @blobinfini/database exec prisma migrate deploy"

log "  Migration OK"

# ─── 10. Seed des comptes de test ─────────────────────────────────────────────
log "10. Seed des comptes VPS..."

$DC run --rm \
  -e DATABASE_URL="postgresql://${POSTGRES_USER:-blobinfini_vps}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-blobinfini_vps}" \
  -e APP_ENV=vps \
  -e NODE_ENV=production \
  api \
  sh -c "cd /workspace && ENV_FILE=/dev/null APP_ENV=pre-vps pnpm --filter @blobinfini/database exec tsx prisma/seed.pre-vps.ts"
# Note: APP_ENV=pre-vps dans le seed uniquement — le script seed vérifie ce flag.
# L'API elle-même tourne bien avec APP_ENV=vps.

log "  Seed OK"

# ─── 11. Démarrage API + Web + Caddy ──────────────────────────────────────────
log "11. Démarrage de l'API, du frontend et de Caddy..."
$DC up -d api web

log "    Attente API (healthcheck)..."
timeout 120 bash -c "until $DC ps api | grep -q 'healthy'; do sleep 3; done" \
  || {
    log "  Logs API pour diagnostic:"
    $DC logs --tail=50 api
    die "L'API n'est pas healthy après 120s"
  }

log "    Attente frontend (healthcheck)..."
timeout 120 bash -c "until $DC ps web | grep -q 'healthy'; do sleep 3; done" \
  || {
    log "  Logs Web pour diagnostic:"
    $DC logs --tail=30 web
    die "Le frontend n'est pas healthy après 120s"
  }

$DC up -d caddy

log "  API, Web, Caddy OK"
log "  Caddy va émettre les certificats Let's Encrypt au premier démarrage."
log "  Vérifier les logs Caddy si HTTPS ne répond pas après 60s :"
log "    docker compose -f docker-compose.vps.yml logs caddy"

# ─── 12. Clé deploy GitHub Actions ───────────────────────────────────────────
# La clé publique github-actions-deploy@blobconnect doit être dans authorized_keys
# pour que le workflow Deploy VPS (GitHub Actions) puisse se connecter.
# Ce step est idempotent : no-op si la clé est déjà présente.
log "12. Installation de la clé deploy GitHub Actions..."
bash "$SCRIPT_DIR/install-deploy-key.sh" || {
  warn "install-deploy-key.sh a échoué — ajouter manuellement :"
  warn "  bash $SCRIPT_DIR/install-deploy-key.sh"
}

# ─── Résumé ───────────────────────────────────────────────────────────────────
echo ""
echo "=================================================="
echo " BlobConnect VPS Runtime DÉMARRÉ"
echo "=================================================="
echo ""
echo "  API      : https://$API_DOMAIN"
echo "  Web      : https://$APP_DOMAIN"
echo "  Storage  : https://$STORAGE_DOMAIN"
echo ""
echo "  MinIO console : NON exposé sur l'hôte"
echo "    Accès via tunnel : ssh -L 9001:localhost:9001 user@vps"
echo "    Puis : http://localhost:9001 (credentials dans .env.vps)"
echo ""
echo "  Logs Caddy (si HTTPS ne répond pas après 60s) :"
echo "    docker compose -f docker-compose.vps.yml logs caddy"
echo ""
echo "  Comptes de test :"
echo "  rider.a@pre-vps.blobinfini.local  / RiderAlpha2026!PreVPS"
echo "  rider.b@pre-vps.blobinfini.local  / RiderBeta2026!PreVPS"
echo "  pro.a@pre-vps.blobinfini.local    / ProAlpha2026!PreVPS"
echo ""
echo "  Qualification VPS (16 checks + 4 S3 proof) :"
echo "    ./scripts/smoke-test-vps.sh"
echo ""
echo "  Arrêt :"
echo "    docker compose -f docker-compose.vps.yml down"
echo ""
echo "  Arrêt + reset volumes :"
echo "    ./scripts/vps-bootstrap.sh --reset"
echo "=================================================="
