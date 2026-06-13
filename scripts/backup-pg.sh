#!/usr/bin/env bash
# scripts/backup-pg.sh — Sauvegarde PostgreSQL pré-VPS BlobConnect
#
# Usage :
#   ./scripts/backup-pg.sh [--env-file PATH] [--backup-dir PATH]
#
# Variables d'environnement :
#   BACKUP_DIR            Répertoire de destination (défaut: $HOME/backups/blobconnect-prevps)
#   BACKUP_MIN_BYTES      Taille minimale du dump compressé (défaut: 1024)
#   BACKUP_RETENTION_DAYS Rétention en jours (défaut: 7)
#   DC_PROJECT            Nom du projet docker compose (défaut: blobconnect-pre-vps)
#   BACKUP_STATE_FILE     Chemin du fichier d'état JSON (défaut: /var/lib/blob/status/last-backup.json)
#                         Dossier DÉDIÉ (jamais le dossier des dumps en 700), monté en
#                         lecture seule dans le conteneur API pour la page admin "État
#                         système". Fichier en 644 (métadonnée admin-safe, AUCUN secret) :
#                         { status, timestamp, sizeBytes, sha256?, durationMs,
#                         filename(basename), errorCode? }.
#
# Sortie : $BACKUP_DIR/blobconnect_prevps_YYYY-MM-DD_HHMMSS_UTC.sql.gz
#
# Sécurité : le mot de passe transite via un fichier .pgpass éphémère dans le
# container (stdin pipe) — jamais en argument CLI ni dans les logs.
# BACKUP_DIR dans le repo git est refusé.

set -euo pipefail

# Horodatage de départ (ms) pour calculer la durée du backup.
START_MS="$(date +%s%3N 2>/dev/null || echo 0)"
# Fichier d'état JSON (peut être surchargé ; défaut calculé après BACKUP_DIR_ABS).
STATE_FILE="${BACKUP_STATE_FILE:-}"
# Variables remplies au fil de l'exécution, lues par _write_state.
BACKUP_FILE=""
BACKUP_SIZE=""
SHA256=""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/blobconnect-prevps}"
BACKUP_MIN_BYTES="${BACKUP_MIN_BYTES:-1024}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"
DC_PROJECT="${DC_PROJECT:-blobconnect-pre-vps}"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env.pre-vps}"
# BACKUP_PREFIX : préfixe du nom de fichier et du glob de rotation.
# Surcharger pour différencier les stacks (ex: blobsurf_vps).
BACKUP_PREFIX="${BACKUP_PREFIX:-blobconnect_prevps}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)   ENV_FILE="$2";   shift 2 ;;
    --backup-dir) BACKUP_DIR="$2"; shift 2 ;;
    *) echo "Argument inconnu: $1" >&2; exit 1 ;;
  esac
done

ts()  { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
log() { echo "$(ts) [backup] $*"; }
die() { echo "$(ts) [backup] ERREUR FATALE: $*" >&2; exit 1; }

# Écrit le fichier d'état JSON (admin-safe) de manière atomique.
# Usage : _write_state ok | _write_state failed [ERROR_CODE]
# N'expose JAMAIS : mot de passe, chemin complet, host, stack trace.
_write_state() {
  local status="$1" err="${2:-BACKUP_FAILED}"
  [[ -n "$STATE_FILE" ]] || return 0
  local now dir tmp json sha_field=""
  now="$(ts)"
  dir="$(dirname "$STATE_FILE")"
  mkdir -p "$dir" 2>/dev/null || return 0
  # Dossier d'état dédié, traversable par l'API (UID 1000) — best-effort.
  # NB : ne JAMAIS pointer STATE_FILE dans le dossier des dumps (chmod 700).
  chmod 755 "$dir" 2>/dev/null || true
  if [[ "$status" == "ok" ]]; then
    local dur_ms=0 now_ms
    now_ms="$(date +%s%3N 2>/dev/null || echo 0)"
    if [[ "$START_MS" =~ ^[0-9]+$ && "$now_ms" =~ ^[0-9]+$ && "$now_ms" -ge "$START_MS" ]]; then
      dur_ms=$(( now_ms - START_MS ))
    fi
    [[ -n "$SHA256" ]] && sha_field=",\"sha256\":\"${SHA256}\""
    json="{\"status\":\"ok\",\"timestamp\":\"${now}\",\"sizeBytes\":${BACKUP_SIZE:-0},\"durationMs\":${dur_ms}${sha_field},\"filename\":\"$(basename "${BACKUP_FILE:-unknown}")\"}"
  else
    json="{\"status\":\"failed\",\"timestamp\":\"${now}\",\"errorCode\":\"${err}\"}"
  fi
  tmp="${STATE_FILE}.tmp.$$"
  if printf '%s\n' "$json" > "$tmp" 2>/dev/null && mv -f "$tmp" "$STATE_FILE" 2>/dev/null; then
    # 644 : métadonnée admin-safe SANS secret (≠ dumps en 600), lisible par l'API
    # montée en lecture seule. Alternative durcie : 640 + groupe dédié partagé avec
    # le conteneur API (coordination GID requise) — voir docs/ops/admin-system-status.md.
    chmod 644 "$STATE_FILE" 2>/dev/null || true
  else
    rm -f "$tmp" 2>/dev/null || true
  fi
}

log "=== Backup PostgreSQL pré-VPS BlobConnect ==="

# ─── Environnement ────────────────────────────────────────────────────────────
[[ -f "$ENV_FILE" ]] || die "Fichier env introuvable: $ENV_FILE"

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

: "${POSTGRES_USER:?POSTGRES_USER manquant dans $ENV_FILE}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD manquant dans $ENV_FILE}"
: "${POSTGRES_DB:?POSTGRES_DB manquant dans $ENV_FILE}"

log "Env: base=$POSTGRES_DB, utilisateur=$POSTGRES_USER"

# ─── BACKUP_DIR interdit dans le repo (risque commit de données) ──────────────
BACKUP_DIR_ABS="$(realpath -m "$BACKUP_DIR")"
REPO_ROOT_ABS="$(realpath "$REPO_ROOT")"

if [[ "$BACKUP_DIR_ABS" == "$REPO_ROOT_ABS"* ]]; then
  die "SÉCURITÉ: BACKUP_DIR ($BACKUP_DIR_ABS) est dans le repo git.
       Utiliser un chemin hors du repo. Ex: BACKUP_DIR=/var/backups/blobconnect"
fi

# Fichier d'état : dossier DÉDIÉ (jamais dans BACKUP_DIR en 700, non lisible par l'API).
# Surchargeable via BACKUP_STATE_FILE. Monté en lecture seule dans le conteneur API.
[[ -n "$STATE_FILE" ]] || STATE_FILE="/var/lib/blob/status/last-backup.json"

# ─── Détecter le container postgres actif ────────────────────────────────────
PG_CONTAINER=$(docker ps \
  --filter "name=${DC_PROJECT}-postgres" \
  --filter "status=running" \
  --format "{{.Names}}" | head -1)

[[ -n "$PG_CONTAINER" ]] || die "Container postgres introuvable ou arrêté.
       Vérifier: docker ps --filter 'name=${DC_PROJECT}-postgres'"

log "Container postgres: $PG_CONTAINER"

# ─── Répertoire de backup (chmod 700 : données sensibles) ─────────────────────
mkdir -p "$BACKUP_DIR_ABS"
chmod 700 "$BACKUP_DIR_ABS"

# ─── Nommage horodaté ─────────────────────────────────────────────────────────
TIMESTAMP=$(date -u '+%Y-%m-%d_%H%M%S_UTC')
BACKUP_FILE="$BACKUP_DIR_ABS/${BACKUP_PREFIX}_${TIMESTAMP}.sql.gz"
BACKUP_TEMP="${BACKUP_FILE}.tmp"
PGPASS_IN_CONTAINER="/tmp/.pgbk_${TIMESTAMP//[^0-9]/}"

log "Destination: $BACKUP_FILE"

# ─── Nettoyage automatique sur erreur ─────────────────────────────────────────
_cleanup() {
  local code=$?
  [[ -f "$BACKUP_TEMP" ]] && rm -f "$BACKUP_TEMP"
  docker exec "$PG_CONTAINER" rm -f "$PGPASS_IN_CONTAINER" 2>/dev/null || true
  if [[ $code -ne 0 ]]; then
    log "Sortie sur erreur (code: $code)"
    # Trace l'échec dans le fichier d'état (consommé par la page admin "État système").
    _write_state failed "BACKUP_FAILED"
  fi
}
trap _cleanup EXIT

# ─── Fichier .pgpass via stdin pipe ───────────────────────────────────────────
# Approche : le mot de passe est transmis via stdin de `docker exec -i`.
# Dans `ps aux` côté hôte, seul le chemin PGPASSFILE est visible, pas le mot de passe.
# `\` et `:` sont échappés car ce sont des caractères spéciaux du format .pgpass.
_pgpass_escape() {
  local s="$1"
  s="${s//\\/\\\\}"   # backslash en premier
  s="${s//:/\\:}"     # puis les deux-points
  printf '%s' "$s"
}

printf '%s\n' "*:5432:${POSTGRES_DB}:${POSTGRES_USER}:$(_pgpass_escape "$POSTGRES_PASSWORD")" \
  | docker exec -i "$PG_CONTAINER" \
      sh -c "cat > $PGPASS_IN_CONTAINER && chmod 600 $PGPASS_IN_CONTAINER"

docker exec "$PG_CONTAINER" test -f "$PGPASS_IN_CONTAINER" \
  || die "Impossible de créer le fichier .pgpass dans le container."

# ─── pg_dump + gzip ──────────────────────────────────────────────────────────
# PGPASSFILE : libpq lit le mot de passe depuis le fichier — jamais depuis l'env direct.
# --no-password : interdit le prompt interactif (fail-fast si auth échoue).
# --format=plain : SQL direct, restaurable avec `psql` sans pg_restore.
# pipefail : si pg_dump ou gzip échoue, le script s'arrête.
log "Démarrage pg_dump..."

docker exec \
  -e PGPASSFILE="$PGPASS_IN_CONTAINER" \
  "$PG_CONTAINER" \
  pg_dump \
    --username="$POSTGRES_USER" \
    --dbname="$POSTGRES_DB" \
    --no-password \
    --format=plain \
    --encoding=UTF8 \
  | gzip -9 > "$BACKUP_TEMP"

docker exec "$PG_CONTAINER" rm -f "$PGPASS_IN_CONTAINER" 2>/dev/null || true

# ─── Validation ───────────────────────────────────────────────────────────────
[[ -f "$BACKUP_TEMP" ]] \
  || die "Fichier temporaire absent après pg_dump — échec silencieux."

BACKUP_SIZE=$(wc -c < "$BACKUP_TEMP")
(( BACKUP_SIZE >= BACKUP_MIN_BYTES )) \
  || die "FAIL-FAST: Dump trop petit (${BACKUP_SIZE} bytes < ${BACKUP_MIN_BYTES} min).
       Dump probablement vide — vérifier que la DB existe et contient des données."

gzip --test "$BACKUP_TEMP" 2>/dev/null \
  || die "FAIL-FAST: Intégrité gzip échouée — vérifier l'espace disque."

log "Validation: ${BACKUP_SIZE} bytes, gzip OK"

# ─── Promotion atomique (mv = atomique sur le même filesystem) ────────────────
mv "$BACKUP_TEMP" "$BACKUP_FILE"
chmod 600 "$BACKUP_FILE"

# Checksum SHA256 (optionnel — si l'outil est disponible).
if command -v sha256sum >/dev/null 2>&1; then
  SHA256="$(sha256sum "$BACKUP_FILE" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  SHA256="$(shasum -a 256 "$BACKUP_FILE" | awk '{print $1}')"
fi

log "Backup: $(basename "$BACKUP_FILE") ($(stat -c '%a %U:%G' "$BACKUP_FILE"))"

# ─── Rotation 7 jours ─────────────────────────────────────────────────────────
DELETED=0
while IFS= read -r -d '' old; do
  log "Rotation: suppression de $(basename "$old")"
  rm -f "$old"
  (( DELETED++ )) || true
done < <(find "$BACKUP_DIR_ABS" -maxdepth 1 \
           -name "${BACKUP_PREFIX}_*.sql.gz" \
           -mtime +"$BACKUP_RETENTION_DAYS" -print0 2>/dev/null)

REMAINING=$(find "$BACKUP_DIR_ABS" -maxdepth 1 -name "${BACKUP_PREFIX}_*.sql.gz" | wc -l)

# ─── État JSON (succès) — consommé par la page admin "État système" ──────────
_write_state ok

log "=== Backup terminé avec succès ==="
log "  Fichier   : $BACKUP_FILE"
log "  Taille    : ${BACKUP_SIZE} bytes"
log "  Conservés : $REMAINING (rotation: $DELETED supprimé(s))"
log "  État      : $STATE_FILE"
log "  Valider   : ./scripts/restore-blobsurf.sh $BACKUP_FILE  # (ou restore-pg.sh pour pre-vps)"

trap - EXIT
