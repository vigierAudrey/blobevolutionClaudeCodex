#!/usr/bin/env bash
# scripts/r2-restore-test.sh — Test de restauration depuis Cloudflare R2
#
# Télécharge le dernier backup PG depuis R2, vérifie le SHA256,
# vérifie l'en-tête age (fichier chiffré valide), et OPTIONNELLEMENT
# déchiffre + valide la restauration si une clé privée est fournie.
#
# En production automatisée (cron) : aucune clé privée sur le VPS.
#   → Vérifie que le fichier existe, SHA256 OK, header age valide.
#   → Verdict : "DOWNLOADABLE & ENCRYPTED — decrypt test à faire manuellement trimestriel."
#
# En test manuel (avec clé privée) :
#   BACKUP_AGE_IDENTITY=/path/to/backup.key ./scripts/r2-restore-test.sh
#   → Télécharge + déchiffre + dry-run restore PostgreSQL complet.
#
# Usage :
#   ./scripts/r2-restore-test.sh [--env-file PATH] [--backup-dir PATH]
#   BACKUP_AGE_IDENTITY=/tmp/key ./scripts/r2-restore-test.sh  # test complet
#
# Cron recommandé (dimanche 5h30 UTC, après weekly-restore-test à 5h00) :
#   30 5 * * 0 DC_PROJECT=blobconnect-blobsurf \
#              ENV_FILE=/home/audrey/blob-app/.env.vps \
#              /home/audrey/blob-app/scripts/r2-restore-test.sh \
#              >> /home/audrey/backups/blobsurf/logs/r2-restore-test.log 2>&1

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)   ENV_FILE="$2";   shift 2 ;;
    --backup-dir) BACKUP_DIR="$2"; shift 2 ;;
    *) printf 'Argument inconnu: %s\n' "$1" >&2; exit 1 ;;
  esac
done

ENV_FILE="${ENV_FILE:-/home/audrey/blob-app/.env.vps}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/blobsurf}"
RCLONE_REMOTE="${RCLONE_REMOTE:-r2-backups}"
R2_BUCKET="${R2_BUCKET:-blobsurf-vps-backups}"
DC_PROJECT="${DC_PROJECT:-blobconnect-blobsurf}"
# Clé privée optionnelle — si présente, déchiffrement + dry-run restore complet
BACKUP_AGE_IDENTITY="${BACKUP_AGE_IDENTITY:-}"

ts()  { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
log() { printf '%s [r2-restore-test] %s\n' "$(ts)" "$*"; }
die() { printf '%s [r2-restore-test] ERREUR FATALE: %s\n' "$(ts)" "$*" >&2; exit 1; }

LOCK_FILE="/tmp/blobsurf-r2-restore-test.lock"
exec 200>"$LOCK_FILE"
if ! flock -w 60 200; then
  die "Impossible d'acquérir le verrou après 60s. Un autre test est en cours."
fi

[[ -f "$ENV_FILE" ]] || die "Fichier env introuvable: $ENV_FILE"
set -a; source "$ENV_FILE"; set +a

command -v rclone >/dev/null 2>&1 || die "rclone non installé."

[[ -f "$SCRIPT_DIR/alert.sh" ]] && source "$SCRIPT_DIR/alert.sh" || \
  send_alert() { log "[alert:${1:-?}] ${2:-}"; }

DECRYPT_MODE=false
if [[ -n "$BACKUP_AGE_IDENTITY" ]]; then
  command -v age >/dev/null 2>&1 || die "age non installé (requis pour déchiffrement)."
  [[ -f "$BACKUP_AGE_IDENTITY" ]] || die "Clé privée introuvable: $BACKUP_AGE_IDENTITY"
  DECRYPT_MODE=true
  log "Mode : TÉLÉCHARGEMENT + DÉCHIFFREMENT + RESTORE (clé privée fournie)"
else
  log "Mode : TÉLÉCHARGEMENT + VÉRIFICATION HEADER (pas de clé privée — normal en cron)"
fi

log "=== Test restore R2 BlobSurf ==="

# ─── Trouver le dernier backup PG sur R2 ──────────────────────────────────────
log "Recherche du dernier backup PG sur R2..."

LATEST_R2=""
LATEST_R2="$(timeout 60 rclone lsf \
  "${RCLONE_REMOTE}:${R2_BUCKET}/pg/" \
  --recursive \
  --files-only \
  2>/dev/null | grep '\.sql\.gz\.age$' | sort -r | head -1 || true)"

if [[ -z "$LATEST_R2" ]]; then
  send_alert emergency \
    "R2 restore test : aucun backup PG trouvé sur R2. Upload jamais lancé ?" \
    "r2-restore-test-empty"
  die "Aucun backup PG trouvé sur R2."
fi

LATEST_R2_FULL="${RCLONE_REMOTE}:${R2_BUCKET}/pg/${LATEST_R2}"
BACKUP_BASENAME="$(basename "$LATEST_R2")"
log "Dernier backup R2 : $LATEST_R2"

# Vérifier l'âge du dernier backup (alerte si > 48h)
# Le nom contient YYYY-MM-DD_HHMMSS — on extrait la date
BACKUP_DATE="$(echo "$BACKUP_BASENAME" | grep -oP '\d{4}-\d{2}-\d{2}' | head -1 || true)"
if [[ -n "$BACKUP_DATE" ]]; then
  BACKUP_EPOCH="$(date -d "$BACKUP_DATE" +%s 2>/dev/null || echo "0")"
  NOW_EPOCH="$(date +%s)"
  AGE_H=$(( (NOW_EPOCH - BACKUP_EPOCH) / 3600 ))
  log "Âge du dernier backup R2 : ${AGE_H}h"
  if (( AGE_H > 48 )); then
    send_alert critical \
      "R2 restore test : le dernier backup R2 a ${AGE_H}h. Upload en panne ?" \
      "r2-restore-stale"
  fi
fi

# ─── Téléchargement ───────────────────────────────────────────────────────────
STAGING_DIR="$(mktemp -d /tmp/r2-restore-test-XXXXXXXX)"
_cleanup() {
  rm -rf "$STAGING_DIR"
}
trap _cleanup EXIT

log "Téléchargement depuis R2..."
DOWNLOAD_EXIT=0
DOWNLOAD_LOG="$(mktemp)"
timeout 300 rclone copy \
  "$LATEST_R2_FULL" \
  "$STAGING_DIR/" \
  --retries 3 \
  > "$DOWNLOAD_LOG" 2>&1 || DOWNLOAD_EXIT=$?

if [[ $DOWNLOAD_EXIT -ne 0 ]]; then
  tail -10 "$DOWNLOAD_LOG" | while IFS= read -r line; do log "  rclone: $line"; done
  rm -f "$DOWNLOAD_LOG"
  send_alert emergency \
    "R2 restore test : téléchargement échoué (code: $DOWNLOAD_EXIT) — $BACKUP_BASENAME inaccessible." \
    "r2-restore-test-download"
  die "Téléchargement R2 échoué."
fi
rm -f "$DOWNLOAD_LOG"

DOWNLOADED_FILE="$STAGING_DIR/$BACKUP_BASENAME"
[[ -f "$DOWNLOADED_FILE" ]] || die "Fichier téléchargé introuvable dans le staging dir."
DOWNLOADED_SIZE="$(wc -c < "$DOWNLOADED_FILE")"
log "Téléchargé : $BACKUP_BASENAME (${DOWNLOADED_SIZE} bytes)"

# ─── Vérification SHA256 ──────────────────────────────────────────────────────
SHA256_REMOTE_NAME="${BACKUP_BASENAME%.age}.sha256"
SHA256_REMOTE_PATH="${RCLONE_REMOTE}:${R2_BUCKET}/pg/$(dirname "$LATEST_R2")/${SHA256_REMOTE_NAME}"

SHA256_LOCAL="$STAGING_DIR/${SHA256_REMOTE_NAME}"
SHA256_OK=false

if timeout 30 rclone copy \
  "$SHA256_REMOTE_PATH" \
  "$STAGING_DIR/" \
  --retries 2 2>/dev/null && [[ -f "$SHA256_LOCAL" ]]; then

  # P0-FIX : vérification réelle du SHA256 du fichier .age téléchargé
  # Le manifest contient deux lignes : SHA256_plaintext + SHA256_.age
  # Le SHA256 du .age est vérifiable SANS clé privée → vérification honnête
  AGE_SHA256_EXPECTED="$(awk -v f="$BACKUP_BASENAME" '$2==f{print $1}' "$SHA256_LOCAL" || true)"
  PLAINTEXT_SHA256_PRESENT="$(awk 'NR==1{print $1}' "$SHA256_LOCAL")"

  if [[ -n "$AGE_SHA256_EXPECTED" ]]; then
    log "Vérification SHA256 du fichier .age téléchargé..."
    AGE_SHA256_ACTUAL="$(sha256sum "$DOWNLOADED_FILE" | awk '{print $1}')"
    if [[ "$AGE_SHA256_ACTUAL" == "$AGE_SHA256_EXPECTED" ]]; then
      log "  SHA256 .age VÉRIFIÉ : ${AGE_SHA256_ACTUAL:0:16}... ✓"
      SHA256_OK=true
    else
      log "  ERREUR: SHA256 .age INVALIDE — fichier corrompu sur R2 !"
      log "    attendu : ${AGE_SHA256_EXPECTED:0:16}..."
      log "    obtenu  : ${AGE_SHA256_ACTUAL:0:16}..."
      SHA256_OK=false
      send_alert emergency \
        "R2 restore test : SHA256 .age invalide pour $BACKUP_BASENAME — corrompu sur R2 !" \
        "r2-restore-test-sha256"
      die "SHA256 .age invalide — fichier corrompu."
    fi
  else
    # Ancien format manifest (une seule ligne plaintext, pas de SHA256 .age)
    log "  Manifest présent (SHA256 plaintext: ${PLAINTEXT_SHA256_PRESENT:0:16}...) — pas de SHA256 .age"
    log "  AVERTISSEMENT: Vérification partielle — SHA256 .age absent (ancien manifest)"
    log "  Ce backup a été créé avant le correctif P0 — re-uploader pour avoir un manifest complet."
    SHA256_OK=false
  fi
else
  log "  AVERTISSEMENT: Manifest SHA256 absent sur R2 ou téléchargement échoué."
  log "  (Normal pour les backups créés avant l'installation de ce système)"
  SHA256_OK=false
fi

# ─── Vérification header age ──────────────────────────────────────────────────
# Les fichiers age commencent par "age-encryption.org/v1" (en ASCII, les 20 premiers bytes)
log "Vérification header age (fichier chiffré valide)..."
AGE_MAGIC="$(head -c 20 "$DOWNLOADED_FILE" 2>/dev/null | tr -dc '[:print:]' || true)"
if [[ "$AGE_MAGIC" == "age-encryption.org/v1" ]]; then
  log "  Header age valide : fichier chiffré confirmé."
else
  send_alert emergency \
    "R2 restore test : $BACKUP_BASENAME n'a PAS un header age valide. Fichier corrompu ou non chiffré !" \
    "r2-restore-test-header"
  die "Header age invalide — fichier corrompu ou non chiffré."
fi

# ─── Mode déchiffrement + restore (si clé privée fournie) ─────────────────────
VERDICT=""
if $DECRYPT_MODE; then
  log "Déchiffrement age..."
  DECRYPTED_FILE="${STAGING_DIR}/$(basename "${BACKUP_BASENAME%.age}")"

  AGE_EXIT=0
  age -d -i "$BACKUP_AGE_IDENTITY" -o "$DECRYPTED_FILE" "$DOWNLOADED_FILE" 2>/dev/null || AGE_EXIT=$?
  if [[ $AGE_EXIT -ne 0 ]]; then
    send_alert emergency \
      "R2 restore test : déchiffrement age échoué (code: $AGE_EXIT) — clé incorrecte ou fichier corrompu." \
      "r2-restore-test-decrypt"
    die "Déchiffrement age échoué."
  fi

  # Vérifier l'intégrité gzip
  gzip --test "$DECRYPTED_FILE" 2>/dev/null || \
    die "FAIL: Fichier déchiffré corrompu (gzip test échoué)."
  log "  Déchiffrement OK + gzip valide."

  # Dry-run restore PostgreSQL
  log "Lancement dry-run restore PostgreSQL..."
  RESTORE_LOG="$(mktemp)"
  RESTORE_EXIT=0
  timeout 900 env ENV_FILE="$ENV_FILE" DC_PROJECT="$DC_PROJECT" \
    "$SCRIPT_DIR/restore-blobsurf.sh" "$DECRYPTED_FILE" > "$RESTORE_LOG" 2>&1 || RESTORE_EXIT=$?

  TABLE_COUNT="$(grep -oP 'Tables\s*:\s*\K[0-9]+' "$RESTORE_LOG" 2>/dev/null | head -1 || echo "?")"

  if [[ $RESTORE_EXIT -eq 0 ]]; then
    log "  Restore dry-run OK ($TABLE_COUNT tables)"
    VERDICT="R2 restore test COMPLET : download + decrypt + restore OK — $TABLE_COUNT tables (backup: $BACKUP_BASENAME)"
    send_alert ok "$VERDICT" "r2-restore-test-full"
  else
    tail -30 "$RESTORE_LOG" | while IFS= read -r line; do log "  restore: $line"; done
    VERDICT="R2 restore test ÉCHOUÉ : restore dry-run exit=$RESTORE_EXIT (backup: $BACKUP_BASENAME)"
    send_alert emergency "$VERDICT" "r2-restore-test-full"
    rm -f "$RESTORE_LOG"
    die "Dry-run restore échoué."
  fi
  rm -f "$RESTORE_LOG"
else
  # Sans clé privée — verdict honnête sur ce qui est et n'est pas vérifié
  if $SHA256_OK; then
    SHA256_STATUS="SHA256 .age VÉRIFIÉ"
    PARTIAL_LEVEL="ok"
  else
    SHA256_STATUS="SHA256 .age non vérifié (manifest absent ou ancien format)"
    PARTIAL_LEVEL="critical"
  fi
  VERDICT="R2 restore test PARTIEL (sans clé privée) : fichier présent (${DOWNLOADED_SIZE}B), header age OK, ${SHA256_STATUS}. Intégrité complète = test manuel trimestriel avec BACKUP_AGE_IDENTITY."
  send_alert "$PARTIAL_LEVEL" "$VERDICT" "r2-restore-test-partial"
fi

log "=== R2 RESTORE TEST TERMINÉ ==="
log "  VERDICT : $VERDICT"
log ""
log "Pour tester le déchiffrement complet (trimestriel) :"
log "  BACKUP_AGE_IDENTITY=/path/to/backup.key ENV_FILE=$ENV_FILE \\"
log "  DC_PROJECT=$DC_PROJECT ./scripts/r2-restore-test.sh"

trap - EXIT
rm -rf "$STAGING_DIR"
