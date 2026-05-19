#!/usr/bin/env bash
# pre-vps-bootstrap.sh — Bootstrap complet de l'environnement pré-VPS BlobConnect
#
# Ce script est le point d'entrée unique.
# Il orchestre dans l'ordre :
#   1. Vérification des prérequis (Docker, mkcert, pnpm)
#   2. Validation du .env.pre-vps
#   3. Génération des certs TLS mkcert
#   4. Entrée /etc/hosts (optionnelle avec --hosts)
#   5. Build des images Docker production
#   6. Démarrage des services infrastructure (postgres, redis, minio, mailpit)
#   7. Migration Prisma (migrate deploy — jamais db push)
#   8. Seed des comptes de test stables
#   9. Démarrage de l'API et du frontend
#  10. Démarrage de nginx
#
# Usage :
#   ./scripts/pre-vps-bootstrap.sh              # Bootstrap complet
#   ./scripts/pre-vps-bootstrap.sh --reset      # Repart de zéro (volumes détruits)
#   ./scripts/pre-vps-bootstrap.sh --no-build   # Skip le build Docker (images déjà buildées)
#   ./scripts/pre-vps-bootstrap.sh --hosts      # Ajoute les entrées /etc/hosts (sudo requis)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env.pre-vps"
CERTS_DIR="$REPO_ROOT/docker/certs/pre-vps"
DC="docker compose -f $REPO_ROOT/docker-compose.pre-vps.yml --env-file $ENV_FILE"

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

# ─── Garde anti-production absolue ───────────────────────────────────────────
if [ "${NODE_ENV:-}" = "production" ] && [ "${APP_ENV:-}" != "pre-vps" ]; then
  echo "ABORT: NODE_ENV=production sans APP_ENV=pre-vps." >&2
  echo "       Ce script ne doit JAMAIS tourner en production réelle." >&2
  exit 1
fi

log() { echo "[bootstrap] $*"; }
die() { echo "[bootstrap] ERREUR: $*" >&2; exit 1; }

log "=== Bootstrap pré-VPS BlobConnect ==="
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

# ─── 2. Fichier .env.pre-vps ──────────────────────────────────────────────────
log "2. Validation du fichier .env.pre-vps..."

if [ ! -f "$ENV_FILE" ]; then
  log "  .env.pre-vps introuvable. Copie depuis .env.pre-vps.example..."
  cp "$REPO_ROOT/.env.pre-vps.example" "$ENV_FILE"
  log "  ATTENTION : .env.pre-vps créé avec des valeurs CHANGEME."
  log "  Lancez d'abord : ./scripts/generate-secrets.sh --pre-vps >> .env.pre-vps"
  log "  Puis éditez .env.pre-vps et relancez ce script."
  exit 1
fi

bash "$SCRIPT_DIR/check-pre-vps-env.sh" "$ENV_FILE" || {
  die "Validation de l'env échouée. Corriger .env.pre-vps avant de continuer."
}

# Charger les vars pour les utiliser dans ce script
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# ─── 3. Certificats TLS mkcert ────────────────────────────────────────────────
log "3. Génération des certificats TLS mkcert..."

mkdir -p "$CERTS_DIR"

if [ ! -f "$CERTS_DIR/api.blobinfini.local.pem" ] || [ ! -f "$CERTS_DIR/app.blobinfini.local.pem" ]; then
  # Installer la CA mkcert dans le système (une seule fois)
  mkcert -install

  (cd "$CERTS_DIR" && mkcert api.blobinfini.local)
  (cd "$CERTS_DIR" && mkcert app.blobinfini.local)

  log "  Certificats générés dans $CERTS_DIR"
else
  log "  Certificats déjà présents — skip"
fi

# ─── 4. /etc/hosts (optionnel) ────────────────────────────────────────────────
if [ "$ADD_HOSTS" = "true" ]; then
  log "4. Ajout des entrées /etc/hosts (sudo requis)..."
  for domain in api.blobinfini.local app.blobinfini.local; do
    if ! grep -q "$domain" /etc/hosts; then
      echo "127.0.0.1  $domain" | sudo tee -a /etc/hosts
      log "  Ajouté: 127.0.0.1  $domain"
    else
      log "  Déjà présent: $domain"
    fi
  done
else
  log "4. /etc/hosts — skip (relancer avec --hosts pour l'ajouter automatiquement)"
  log "   Vérifier manuellement:"
  log "     grep blobinfini.local /etc/hosts"
  log "   Ou ajouter manuellement:"
  log "     echo '127.0.0.1  api.blobinfini.local app.blobinfini.local' | sudo tee -a /etc/hosts"
fi

# ─── 5. Reset volumes si demandé ──────────────────────────────────────────────
if [ "$RESET" = "true" ]; then
  log "5. Reset — arrêt et suppression des volumes pré-VPS..."
  $DC down -v --remove-orphans 2>/dev/null || true
  log "  Volumes supprimés"
else
  log "5. Reset volumes — skip (relancer avec --reset pour repartir de zéro)"
fi

# ─── 6. Build images Docker production ────────────────────────────────────────
if [ "$NO_BUILD" = "false" ]; then
  log "6. Build des images Docker production (peut prendre plusieurs minutes)..."
  log "   Build API..."
  $DC build api
  log "   Build Web..."
  $DC build web
  log "  Build terminé"
else
  log "6. Build Docker — skip (--no-build)"
  # Vérifier que les images existent réellement — sans build, une image absente
  # provoque une erreur trompeuse lors de 'DC run --rm api' (étapes 8 et 9).
  API_IMAGE=$($DC config --images 2>/dev/null | grep api | head -1 || true)
  if ! docker image inspect blobconnect-pre-vps-api >/dev/null 2>&1 \
    && ! docker image inspect "${API_IMAGE:-__absent__}" >/dev/null 2>&1; then
    die "--no-build spécifié mais aucune image API trouvée localement.
       Lancer d'abord : ./scripts/pre-vps-bootstrap.sh (sans --no-build) pour builder les images."
  fi
fi

# ─── 7. Démarrage infra (postgres, redis, minio, mailpit) ────────────────────
log "7. Démarrage de l'infrastructure..."
$DC up -d postgres redis minio mailpit

log "   Attente de la disponibilité de postgres..."
timeout 60 bash -c "until $DC exec -T postgres pg_isready -U ${POSTGRES_USER:-blobinfini_pvps} >/dev/null 2>&1; do sleep 2; done" \
  || die "postgres n'est pas prêt après 60s"

log "   Attente de la disponibilité de redis..."
timeout 30 bash -c "until $DC exec -T redis redis-cli -a '${REDIS_PASSWORD}' ping 2>/dev/null | grep -q PONG; do sleep 2; done" \
  || die "redis n'est pas prêt après 30s"

log "  Infrastructure OK"

# ─── 8. Migration Prisma (migrate deploy — JAMAIS db push) ───────────────────
log "8. Migration Prisma (migrate deploy)..."

# Construire DATABASE_URL pour l'exécution locale (hors Docker)
PVPS_DB_URL="postgresql://${POSTGRES_USER:-blobinfini_pvps}:${POSTGRES_PASSWORD}@localhost:5432/${POSTGRES_DB:-blobinfini_pvps}"

# Vérifier que le port postgres est accessible depuis l'hôte
# Note: le docker-compose.pre-vps.yml n'expose PAS le port postgres sur l'hôte.
# On expose temporairement le port pour la migration, puis on le referme.
# Alternative : exécuter migrate dans un container.

log "   Exécution de prisma migrate deploy dans un container..."
$DC run --rm \
  -e DATABASE_URL="postgresql://${POSTGRES_USER:-blobinfini_pvps}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-blobinfini_pvps}" \
  -e APP_ENV=pre-vps \
  api \
  sh -c "cd /workspace && pnpm --filter @blobinfini/database exec prisma migrate deploy"

log "  Migration OK"

# ─── 9. Seed des comptes de test stables ──────────────────────────────────────
log "9. Seed des comptes pré-VPS..."

$DC run --rm \
  -e DATABASE_URL="postgresql://${POSTGRES_USER:-blobinfini_pvps}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-blobinfini_pvps}" \
  -e APP_ENV=pre-vps \
  -e NODE_ENV=production \
  api \
  sh -c "cd /workspace && ENV_FILE=/dev/null APP_ENV=pre-vps pnpm --filter @blobinfini/database exec tsx prisma/seed.pre-vps.ts"

log "  Seed OK"

# ─── 10. Démarrage API + Web + nginx ──────────────────────────────────────────
log "10. Démarrage de l'API, du frontend et de nginx..."
$DC up -d api web

log "    Attente de l'API (healthcheck)..."
timeout 120 bash -c "until $DC ps api | grep -q 'healthy'; do sleep 3; done" \
  || {
    log "  Logs API pour diagnostic:"
    $DC logs --tail=50 api
    die "L'API n'est pas healthy après 120s"
  }

log "    Attente du frontend (healthcheck)..."
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
echo " BlobConnect pré-VPS DÉMARRÉ"
echo "=================================================="
echo ""
echo "  API  : https://api.blobinfini.local"
echo "  Web  : https://app.blobinfini.local"
echo "  MinIO console : http://localhost:9001"
echo "  Mailpit UI    : http://localhost:8025"
echo ""
echo "  Comptes de test :"
echo "  rider.a@pre-vps.blobinfini.local  / RiderAlpha2026!PreVPS"
echo "  rider.b@pre-vps.blobinfini.local  / RiderBeta2026!PreVPS"
echo "  pro.a@pre-vps.blobinfini.local    / ProAlpha2026!PreVPS"
echo ""
echo "  Qualification :"
echo "    ./scripts/smoke-test.sh"
echo ""
echo "  Arrêt :"
echo "    docker compose -f docker-compose.pre-vps.yml down"
echo ""
echo "  Arrêt + reset volumes :"
echo "    ./scripts/pre-vps-bootstrap.sh --reset"
echo "=================================================="
