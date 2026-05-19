#!/usr/bin/env bash
# scripts/r2-rotate.sh — Rotation des backups sur Cloudflare R2
#
# Supprime les backups R2 les plus anciens au-delà du quota de rétention.
# Liste les fichiers .age par préfixe, les trie par nom (= par date, timestamps ISO),
# conserve les N plus récents, supprime le reste.
#
# Rétention par défaut :
#   PG    (pg/) :    30 fichiers (≈ 1 mois de backups quotidiens)
#   MinIO (minio/) : 14 fichiers (≈ 2 semaines)
#
# Usage :
#   ./scripts/r2-rotate.sh [--env-file PATH]
#
# Cron recommandé (5h00 UTC, après encrypt-upload à 4h30) :
#   0 5 * * * ENV_FILE=/home/audrey/blob-app/.env.vps \
#             /home/audrey/blob-app/scripts/r2-rotate.sh \
#             >> /home/audrey/backups/blobsurf/logs/r2-rotate.log 2>&1

set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DRY_RUN=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --dry-run)  DRY_RUN=true; shift ;;
    *) printf 'Argument inconnu: %s\n' "$1" >&2; exit 1 ;;
  esac
done

ENV_FILE="${ENV_FILE:-/home/audrey/blob-app/.env.vps}"
RCLONE_REMOTE="${RCLONE_REMOTE:-r2-backups}"
R2_BUCKET="${R2_BUCKET:-blobsurf-vps-backups}"
R2_RETAIN_PG="${R2_RETAIN_PG:-30}"
R2_RETAIN_MINIO="${R2_RETAIN_MINIO:-14}"

ts()  { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
log() { printf '%s [r2-rotate] %s\n' "$(ts)" "$*"; }
die() { printf '%s [r2-rotate] ERREUR FATALE: %s\n' "$(ts)" "$*" >&2; exit 1; }

LOCK_FILE="/tmp/blobsurf-r2-rotate.lock"
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  log "Instance déjà en cours. Skip."
  exit 0
fi

if $DRY_RUN; then
  log "=== Rotation R2 — MODE DRY-RUN (aucune suppression) ==="
else
  log "=== Rotation R2 (PG: garde ${R2_RETAIN_PG}, MinIO: garde ${R2_RETAIN_MINIO}) ==="
fi

[[ -f "$ENV_FILE" ]] || die "Fichier env introuvable: $ENV_FILE"
set -a; source "$ENV_FILE"; set +a

command -v rclone >/dev/null 2>&1 || die "rclone non installé."

[[ -f "$SCRIPT_DIR/alert.sh" ]] && source "$SCRIPT_DIR/alert.sh" || \
  send_alert() { log "[alert:${1:-?}] ${2:-}"; }

# _rotate_prefix PREFIX RETAIN_COUNT
# Liste les fichiers .age sous PREFIX, trie par nom décroissant,
# conserve les RETAIN_COUNT plus récents, supprime le reste.
_rotate_prefix() {
  local prefix="$1"
  local retain="$2"
  local full_path="${RCLONE_REMOTE}:${R2_BUCKET}/${prefix}"

  log "  Prefix: ${prefix}"

  # lsf --recursive --files-only liste tous les fichiers dans tous les sous-répertoires
  # Format : YYYY/MM/filename.age — tri alphabétique = tri chronologique (timestamps ISO)
  declare -a ALL_FILES=()
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    [[ "$f" == *.age ]] || continue   # ignorer SHA256 et autres
    ALL_FILES+=("$f")
  done < <(timeout 60 rclone lsf \
    "$full_path" \
    --recursive \
    --files-only \
    2>/dev/null | sort -r)   # sort -r = plus récent en premier (noms ISO)

  local total="${#ALL_FILES[@]}"
  log "    Fichiers .age présents: $total (rétention: $retain)"

  if (( total <= retain )); then
    log "    Aucune suppression nécessaire."
    return 0
  fi

  local to_delete=$(( total - retain ))
  log "    Suppression de $to_delete fichier(s) ancien(s)..."

  local deleted=0
  for (( i=retain; i<total; i++ )); do
    local file="${ALL_FILES[$i]}"
    log "    Suppression: ${prefix}${file}"

    if $DRY_RUN; then
      log "    [DRY-RUN] Supprimerait: ${prefix}${file}"
      deleted=$(( deleted + 1 ))
      continue
    fi

    # P1-FIX : rclone deletefile pour un objet unique (rclone delete utilise la sémantique
    # préfixe S3 et pourrait supprimer d'autres objets partageant le même préfixe)
    DEL_EXIT=0
    timeout 30 rclone deletefile "${full_path}${file}" 2>/dev/null || DEL_EXIT=$?
    if [[ $DEL_EXIT -ne 0 ]]; then
      log "    AVERTISSEMENT: Suppression échouée pour ${file} (code: $DEL_EXIT)"
      continue
    fi

    # Supprimer aussi le SHA256 associé (même nom sans .age + .sha256)
    local sha_file="${file%.age}.sha256"
    DEL_SHA_EXIT=0
    timeout 30 rclone deletefile "${full_path}${sha_file}" 2>/dev/null || DEL_SHA_EXIT=$?
    if [[ $DEL_SHA_EXIT -ne 0 ]]; then
      log "    AVERTISSEMENT: Manifest SHA256 introuvable ou suppression échouée pour ${sha_file} (non bloquant)"
    fi

    deleted=$(( deleted + 1 ))
  done

  log "    Supprimés: $deleted / $to_delete"
}

ROTATE_FAILED=0

_rotate_prefix "pg/" "$R2_RETAIN_PG" || (( ROTATE_FAILED++ )) || true
_rotate_prefix "minio/" "$R2_RETAIN_MINIO" || (( ROTATE_FAILED++ )) || true

if [[ $ROTATE_FAILED -gt 0 ]]; then
  send_alert critical \
    "R2 rotation échouée sur ${ROTATE_FAILED} prefix(es). Risque de coût R2 incontrôlé." \
    "r2-rotate-failed"
  exit 1
fi

log "=== Rotation R2 terminée ==="
trap - EXIT
