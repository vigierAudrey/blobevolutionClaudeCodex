#!/usr/bin/env bash
# vps-bootstrap.sh — Bootstrap complet de l'environnement VPS Runtime BlobConnect
#
# Ce script orchestre dans l'ordre :
#   1. Vérification des prérequis (Docker, mkcert, pnpm)
#   2. Validation du .env.vps
#   3. Génération des certs TLS mkcert (api + app + storage)
#   4. Entrée /etc/hosts (optionnelle avec --hosts)
#   5. Reset volumes (optionnel avec --reset)
#   6. Build des images Docker production
#   7. Démarrage infrastructure (postgres, redis, minio, mailpit)
#   8. Configuration MinIO : bucket + policy GET anonyme
#   9. Migration Prisma (migrate deploy — jamais db push)
#  10. Seed des comptes de test stables
#  11. Démarrage API + frontend + nginx
#
# Différences vs pre-vps-bootstrap.sh :
#   - docker-compose.vps.yml / .env.vps
#   - 3 domaines TLS générés (api + app + STORAGE)
#   - Étape 8 : mc (MinIO Client) configure bucket policy GET anonyme
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
CERTS_DIR="$REPO_ROOT/docker/certs/vps"
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

if ! command -v mkcert >/dev/null 2>&1; then
  die "mkcert n'est pas installé.
       Ubuntu/Debian : sudo apt install libnss3-tools && wget -O mkcert https://github.com/FiloSottile/mkcert/releases/latest/download/mkcert-v1.4.4-linux-amd64 && chmod +x mkcert && sudo mv mkcert /usr/local/bin/
       macOS         : brew install mkcert"
fi

log "  Docker OK, pnpm OK, mkcert OK"

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

# Charger les vars
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

STORAGE_DOMAIN="${STORAGE_DOMAIN:-storage.blobinfini.local}"
API_DOMAIN="${API_DOMAIN:-api.blobinfini.local}"
APP_DOMAIN="${APP_DOMAIN:-app.blobinfini.local}"
BUCKET="${S3_BUCKET:-blobinfini-vps}"

# ─── 3. Certificats TLS mkcert (3 domaines) ───────────────────────────────────
log "3. Génération des certificats TLS mkcert (api, app, storage)..."

mkdir -p "$CERTS_DIR"

# api
if [ ! -f "$CERTS_DIR/${API_DOMAIN}.pem" ]; then
  mkcert -install 2>/dev/null || true
  (cd "$CERTS_DIR" && mkcert "$API_DOMAIN")
  log "  Cert généré : $API_DOMAIN"
else
  log "  Cert déjà présent : $API_DOMAIN — skip"
fi

# app
if [ ! -f "$CERTS_DIR/${APP_DOMAIN}.pem" ]; then
  (cd "$CERTS_DIR" && mkcert "$APP_DOMAIN")
  log "  Cert généré : $APP_DOMAIN"
else
  log "  Cert déjà présent : $APP_DOMAIN — skip"
fi

# storage (NEW : absent du pre-vps bootstrap)
if [ ! -f "$CERTS_DIR/${STORAGE_DOMAIN}.pem" ]; then
  (cd "$CERTS_DIR" && mkcert "$STORAGE_DOMAIN")
  log "  Cert généré : $STORAGE_DOMAIN"
else
  log "  Cert déjà présent : $STORAGE_DOMAIN — skip"
fi

log "  Certs TLS OK dans $CERTS_DIR"

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

# ─── 7. Démarrage infra (postgres, redis, minio, mailpit) ────────────────────
log "7. Démarrage de l'infrastructure..."
$DC up -d postgres redis minio mailpit

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

# ─── 8. Configuration MinIO : bucket + policy GET anonyme ────────────────────
#
# Pourquoi ici et pas via env var ?
#   - MinIO ne supporte pas de policy bucket au démarrage via variable d'env
#   - La policy doit être définie via l'API MC après que le bucket existe
#
# Stratégie mc (MinIO Client) via conteneur Docker :
#   - Accès interne au réseau blobconnect-vps_vps (pas besoin de port hôte)
#   - MC_HOST_minio : URL interne Docker minio:9000
#   - `mb --ignore-existing` : crée le bucket s'il n'existe pas encore
#   - `anonymous set download` : GET anonyme, PUT/LIST toujours requiert auth
#
# Nota : si le bucket existe déjà (--no-reset), la commande est idempotente.

log "8. Configuration MinIO (bucket + policy GET anonyme)..."

MINIO_INT_URL="http://${S3_ACCESS_KEY_ID}:${S3_SECRET_ACCESS_KEY}@minio:9000"

# Créer le bucket (idempotent)
docker run --rm \
  --network "blobconnect-vps_vps" \
  -e "MC_HOST_minio=${MINIO_INT_URL}" \
  "$MC_IMAGE" \
  mb --ignore-existing "minio/${BUCKET}" \
  || die "mc mb échoué"

log "   Bucket '${BUCKET}' OK"

# Définir la policy GET anonyme (download = GET seul, pas de listing)
docker run --rm \
  --network "blobconnect-vps_vps" \
  -e "MC_HOST_minio=${MINIO_INT_URL}" \
  "$MC_IMAGE" \
  anonymous set download "minio/${BUCKET}" \
  || die "mc anonymous set download échoué"

log "   Policy GET anonyme définie sur '${BUCKET}' OK"

# Vérifier la policy (strict : "none" = absence de policy = échec)
POLICY_RESULT=$(docker run --rm \
  --network "blobconnect-vps_vps" \
  -e "MC_HOST_minio=${MINIO_INT_URL}" \
  "$MC_IMAGE" \
  anonymous get "minio/${BUCKET}" 2>&1 || echo "ERROR")

if echo "$POLICY_RESULT" | grep -qi "download"; then
  log "   Vérification policy OK : $POLICY_RESULT"
else
  die "Policy bucket incorrecte après application (résultat: $POLICY_RESULT). 'none' = aucune policy anonyme. Vérifier mc anonymous set download."
fi

# Configuration CORS MinIO : nécessaire pour les uploads cross-origin depuis le navigateur
# (app.$APP_DOMAIN → storage.$STORAGE_DOMAIN via presigned PUT)
log "8b. Configuration CORS MinIO pour presigned PUT cross-origin..."

CORS_RULE='{"CORSRules":[{"AllowedHeaders":["*"],"AllowedMethods":["GET","PUT","HEAD"],"AllowedOrigins":["https://'"${APP_DOMAIN}"'"],"ExposeHeaders":["ETag","x-amz-request-id"],"MaxAgeSeconds":3600}]}'

docker run --rm \
  --network "blobconnect-vps_vps" \
  -e "MC_HOST_minio=${MINIO_INT_URL}" \
  "$MC_IMAGE" \
  cors set --json /dev/stdin "minio/${BUCKET}" <<< "$CORS_RULE" \
  || die "mc cors set échoué"

log "   CORS MinIO configuré pour origin https://${APP_DOMAIN} OK"

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

# ─── 11. Démarrage API + Web + nginx ──────────────────────────────────────────
log "11. Démarrage de l'API, du frontend et de nginx..."
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

$DC up -d nginx

log "  API, Web, nginx OK"

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
