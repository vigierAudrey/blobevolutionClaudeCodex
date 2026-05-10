#!/usr/bin/env bash
# scripts/restore-pg.sh — Validation de sauvegarde PostgreSQL pré-VPS (DRY-RUN UNIQUEMENT)
#
# Ce script valide un backup en le restaurant dans un container PostgreSQL éphémère.
# Aucune donnée de production n'est modifiée.
#
# Usage :
#   ./scripts/restore-pg.sh <fichier.sql.gz> [--env-file PATH]
#
# ─── PROCÉDURE DE RESTORE LIVE (documentation — NON automatisée intentionnellement) ───
#
# Le restore live est une opération destructrice (DROP DATABASE).
# Il doit être exécuté manuellement, après validation avec ce script.
#
# Étapes :
#   1. Valider le backup avec ce script (dry-run)
#   2. Arrêter les services :
#        docker compose -f docker-compose.pre-vps.yml stop api web nginx
#   3. Identifier le container postgres :
#        docker ps --filter "name=blobconnect-pre-vps-postgres"
#   4. Terminer les connexions actives :
#        docker exec <container> psql -U <POSTGRES_USER> -d postgres \
#          -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity \
#              WHERE datname='<POSTGRES_DB>' AND pid <> pg_backend_pid();"
#   5. Recréer la base :
#        docker exec <container> psql -U <POSTGRES_USER> -d postgres \
#          -c "DROP DATABASE \"<POSTGRES_DB>\"; \
#              CREATE DATABASE \"<POSTGRES_DB>\" OWNER \"<POSTGRES_USER>\";"
#   6. Restaurer :
#        gunzip -c <backup.sql.gz> | \
#          docker exec -i <container> psql -U <POSTGRES_USER> -d <POSTGRES_DB>
#   7. Redémarrer :
#        docker compose -f docker-compose.pre-vps.yml up -d api web nginx
#   8. Appliquer les migrations éventuellement manquantes :
#        docker compose -f docker-compose.pre-vps.yml run --rm api \
#          sh -c "pnpm --filter @blobinfini/database exec prisma migrate deploy"
#   9. Valider : ./scripts/smoke-test.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env.pre-vps}"
BACKUP_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --help|-h)
      grep '^#' "$0" | head -35 | sed 's/^# \?//'
      exit 0 ;;
    -*)  echo "Option inconnue: $1" >&2; exit 1 ;;
    *)   BACKUP_FILE="$1"; shift ;;
  esac
done

ts()  { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
log() { echo "$(ts) [restore] $*"; }
die() { echo "$(ts) [restore] ERREUR FATALE: $*" >&2; exit 1; }

log "=== Validation de backup PostgreSQL pré-VPS (dry-run) ==="

# ─── Vérifications préalables ─────────────────────────────────────────────────
[[ -n "$BACKUP_FILE" ]] \
  || die "Fichier de backup manquant. Usage: $0 <fichier.sql.gz>"

[[ -f "$BACKUP_FILE" ]] \
  || die "Fichier introuvable: $BACKUP_FILE"

command -v docker >/dev/null 2>&1 \
  || die "docker n'est pas installé ou pas dans PATH."

BACKUP_FILE_ABS="$(realpath "$BACKUP_FILE")"
log "Fichier: $BACKUP_FILE_ABS ($(wc -c < "$BACKUP_FILE_ABS") bytes)"

# Vérifier l'intégrité gzip avant de démarrer quoi que ce soit
gzip --test "$BACKUP_FILE_ABS" 2>/dev/null \
  || die "FAIL-FAST: Fichier gzip corrompu — ce backup ne peut pas être restauré."
log "Intégrité gzip: OK"

# ─── Charger l'environnement ──────────────────────────────────────────────────
[[ -f "$ENV_FILE" ]] \
  || die "Fichier env introuvable: $ENV_FILE"

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

: "${POSTGRES_USER:?POSTGRES_USER manquant dans $ENV_FILE}"
: "${POSTGRES_DB:?POSTGRES_DB manquant dans $ENV_FILE}"

log "Base source: $POSTGRES_DB (propriétaire: $POSTGRES_USER)"

# ─── Container éphémère ────────────────────────────────────────────────────────
# Mot de passe aléatoire — ce container est détruit à la fin du script.
# PGPASSWORD est acceptable ici car le mot de passe est éphémère (non-production)
# et le container vit quelques secondes.
EPHEMERAL_NAME="blobconnect-restore-test-$(date -u '+%Y%m%d%H%M%S')"
EPHEMERAL_USER="restore_admin"
EPHEMERAL_DB="restore_target"
EPHEMERAL_PW=$(openssl rand -hex 24)

_cleanup() {
  log "Arrêt et suppression du container éphémère: $EPHEMERAL_NAME"
  docker stop "$EPHEMERAL_NAME" 2>/dev/null || true
  docker rm -f "$EPHEMERAL_NAME" 2>/dev/null || true
}
trap _cleanup EXIT

log "Démarrage du container éphémère $EPHEMERAL_NAME..."
docker run \
  --detach \
  --name "$EPHEMERAL_NAME" \
  --env POSTGRES_USER="$EPHEMERAL_USER" \
  --env POSTGRES_PASSWORD="$EPHEMERAL_PW" \
  --env POSTGRES_DB="$EPHEMERAL_DB" \
  postgis/postgis:15-3.4 \
  > /dev/null

# ─── Attendre que PostgreSQL soit prêt (max 60s) ─────────────────────────────
log "Attente de PostgreSQL (max 60s)..."
for i in $(seq 1 30); do
  if docker exec -e PGPASSWORD="$EPHEMERAL_PW" "$EPHEMERAL_NAME" \
       pg_isready -U "$EPHEMERAL_USER" -d "$EPHEMERAL_DB" -q 2>/dev/null; then
    log "PostgreSQL prêt (tentative $i)"
    break
  fi
  [[ $i -lt 30 ]] || die "PostgreSQL non disponible après 60s.
       Vérifier que l'image postgis/postgis:15-3.4 est présente : docker images | grep postgis"
  sleep 2
done

# ─── Préparer la base cible ────────────────────────────────────────────────────
# Le dump contient ALTER TABLE ... OWNER TO $POSTGRES_USER.
# Ce rôle doit exister dans le container éphémère pour que les OWNER TO réussissent.
docker exec -e PGPASSWORD="$EPHEMERAL_PW" "$EPHEMERAL_NAME" \
  psql -U "$EPHEMERAL_USER" -d "$EPHEMERAL_DB" -q \
  -c "CREATE ROLE \"${POSTGRES_USER}\" LOGIN PASSWORD 'x';" \
  2>/dev/null || true   # ignoré si le rôle existe déjà

RESTORE_DB="restore_test"
docker exec -e PGPASSWORD="$EPHEMERAL_PW" "$EPHEMERAL_NAME" \
  psql -U "$EPHEMERAL_USER" -d "$EPHEMERAL_DB" -q \
  -c "CREATE DATABASE \"${RESTORE_DB}\" OWNER \"${POSTGRES_USER}\";"

# ─── Restauration ─────────────────────────────────────────────────────────────
# gunzip -c → stdout → pipe → psql stdin (-i)
# ON_ERROR_STOP=0 : continue malgré des erreurs mineures (extensions déjà présentes, etc.)
log "Restauration en cours..."
RESTORE_ERRORS=$(mktemp)

gunzip -c "$BACKUP_FILE_ABS" \
  | docker exec -i \
      -e PGPASSWORD="$EPHEMERAL_PW" \
      "$EPHEMERAL_NAME" \
      psql \
        --username="$EPHEMERAL_USER" \
        --dbname="$RESTORE_DB" \
        --variable ON_ERROR_STOP=0 \
        --quiet \
      2>"$RESTORE_ERRORS" || true

# Erreurs fatales = erreurs autres que "already exists"
FATAL=$(grep -c '^ERROR:' "$RESTORE_ERRORS" 2>/dev/null || echo "0")
IGNORABLE=$(grep -c 'already exists' "$RESTORE_ERRORS" 2>/dev/null || echo "0")
FATAL=$(( FATAL - IGNORABLE ))
rm -f "$RESTORE_ERRORS"

if [[ $FATAL -gt 0 ]]; then
  log "Avertissement: $FATAL erreur(s) non-ignorable(s) durant le restore."
  log "  (peut indiquer une incompatibilité de schéma — investiguer)"
fi

# ─── Validation des données ────────────────────────────────────────────────────
TABLE_COUNT=$(docker exec -e PGPASSWORD="$EPHEMERAL_PW" "$EPHEMERAL_NAME" \
  psql -U "$EPHEMERAL_USER" -d "$RESTORE_DB" -t -A \
  -c "SELECT COUNT(*) FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE';")

TABLE_COUNT=$(echo "$TABLE_COUNT" | tr -d '[:space:]')
log "Tables dans le schéma public: $TABLE_COUNT"

(( TABLE_COUNT >= 5 )) \
  || die "FAIL: Seulement ${TABLE_COUNT} table(s) après restore (minimum 5 attendu).
       Le dump est probablement vide ou incomplet."

# ─── Résumé ───────────────────────────────────────────────────────────────────
log "=== DRY-RUN TERMINÉ AVEC SUCCÈS ==="
log "  Backup  : $BACKUP_FILE_ABS"
log "  Tables  : $TABLE_COUNT restaurées"
if [[ $FATAL -gt 0 ]]; then
  log "  VERDICT : BACKUP LISIBLE — $FATAL erreur(s) à investiguer avant restore live"
else
  log "  VERDICT : BACKUP VALIDE — prêt pour restore live si nécessaire"
fi
log ""
log "Procédure de restore live : voir les commentaires en tête de ce script."
