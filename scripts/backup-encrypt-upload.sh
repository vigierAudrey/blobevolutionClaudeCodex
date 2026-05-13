#!/usr/bin/env bash
# scripts/backup-encrypt-upload.sh — Chiffrement age + upload Cloudflare R2
#
# Cherche les backups locaux (*.sql.gz, *.tar.gz) créés dans les dernières
# UPLOAD_WINDOW_HOURS heures sans marqueur .r2, les chiffre avec age
# (chiffrement asymétrique — clé privée JAMAIS sur le VPS), les uploade
# sur Cloudflare R2 via rclone, vérifie l'intégrité, puis pose un marqueur .r2.
#
# SÉCURITÉ :
#   La clé privée age n'est JAMAIS présente sur le VPS.
#   Un attaquant qui compromet le VPS ne peut pas déchiffrer les backups R2.
#
# Prérequis :
#   - age installé          : sudo apt install age
#   - rclone configuré      : rclone config → remote r2-backups
#   - BACKUP_AGE_RECIPIENT  : dans .env.vps (clé publique issue de setup-backup-keys.sh)
#
# Usage :
#   ./scripts/backup-encrypt-upload.sh [--env-file PATH] [--backup-dir PATH]
#
# Cron recommandé (4h30 UTC — après PG 3h00 et MinIO 4h00) :
#   30 4 * * * DC_PROJECT=blobconnect-blobsurf \
#              ENV_FILE=/home/audrey/blob-app/.env.vps \
#              BACKUP_DIR=/home/audrey/backups/blobsurf \
#              /home/audrey/blob-app/scripts/backup-encrypt-upload.sh \
#              >> /home/audrey/backups/blobsurf/logs/encrypt-upload.log 2>&1

set -euo pipefail
umask 077

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
UPLOAD_WINDOW_HOURS="${UPLOAD_WINDOW_HOURS:-25}"
RCLONE_TIMEOUT="${RCLONE_TIMEOUT:-600}"

ts()  { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
log() { printf '%s [encrypt-upload] %s\n' "$(ts)" "$*"; }
die() { printf '%s [encrypt-upload] ERREUR FATALE: %s\n' "$(ts)" "$*" >&2; exit 1; }

# flock — une seule instance à la fois
LOCK_FILE="/tmp/blobsurf-encrypt-upload.lock"
exec 200>"$LOCK_FILE"
if ! flock -w 120 200; then
  die "Impossible d'acquérir le verrou après 120s. Abandon."
fi

log "=== Chiffrement + Upload R2 ==="

# ─── Prérequis ────────────────────────────────────────────────────────────────
[[ -f "$ENV_FILE" ]] || die "Fichier env introuvable: $ENV_FILE"
set -a; source "$ENV_FILE"; set +a

: "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT manquant dans $ENV_FILE (lancer setup-backup-keys.sh)}"

command -v age >/dev/null 2>&1 || \
  die "age non installé. Installer : sudo apt install age"
command -v rclone >/dev/null 2>&1 || \
  die "rclone non installé. Voir : https://rclone.org/install/"
command -v sha256sum >/dev/null 2>&1 || \
  die "sha256sum non disponible (paquet coreutils manquant)."

# Vérifier que le remote rclone existe
rclone listremotes 2>/dev/null | grep -q "^${RCLONE_REMOTE}:" || \
  die "Remote rclone '${RCLONE_REMOTE}' non configuré. Lancer : rclone config"

# Vérifier que le bucket R2 est accessible (test rapide, non bloquant en cas de timeout)
if ! timeout 30 rclone lsd "${RCLONE_REMOTE}:${R2_BUCKET}" >/dev/null 2>&1; then
  die "Bucket R2 '${R2_BUCKET}' inaccessible via remote '${RCLONE_REMOTE}'. Vérifier la connexion et le token R2."
fi

# Charger alert.sh si disponible
[[ -f "$SCRIPT_DIR/alert.sh" ]] && source "$SCRIPT_DIR/alert.sh" || \
  send_alert() { log "[alert:${1:-?}] ${2:-}"; }

# ─── Recherche des fichiers à uploader ────────────────────────────────────────
BACKUP_DIR_ABS="$(realpath "$BACKUP_DIR")"
declare -a FILES_TO_UPLOAD=()

while IFS= read -r -d '' f; do
  # Ignorer fichiers temporaires, marqueurs et déjà chiffrés
  [[ "$f" == *.tmp  ]] && continue
  [[ "$f" == *.r2   ]] && continue
  [[ "$f" == *.age  ]] && continue
  [[ "$f" == *.sha256 ]] && continue
  # Marqueur .r2 = déjà uploadé
  [[ -f "${f}.r2" ]] && continue
  FILES_TO_UPLOAD+=("$f")
done < <(find "$BACKUP_DIR_ABS" \
  \( -name "*.sql.gz" -o -name "*.tar.gz" \) \
  -not -name "*.tmp" \
  -mmin -$(( UPLOAD_WINDOW_HOURS * 60 )) \
  -print0 2>/dev/null)

if [[ ${#FILES_TO_UPLOAD[@]} -eq 0 ]]; then
  log "Aucun nouveau backup à uploader (fenêtre: ${UPLOAD_WINDOW_HOURS}h)."
  log "  (normal si ce script a déjà tourné aujourd'hui)"
  exit 0
fi

log "${#FILES_TO_UPLOAD[@]} fichier(s) à chiffrer et uploader."

UPLOADED=0
FAILED=0

# ─── Traitement de chaque fichier ─────────────────────────────────────────────
for PLAINTEXT_FILE in "${FILES_TO_UPLOAD[@]}"; do
  FILENAME="$(basename "$PLAINTEXT_FILE")"
  ENCRYPTED_TEMP="${PLAINTEXT_FILE}.age.tmp"
  ENCRYPTED_FILE="${PLAINTEXT_FILE}.age"
  SHA256_FILE="${PLAINTEXT_FILE}.sha256"

  log "--- Traitement: $FILENAME ---"

  # Déterminer le sous-répertoire R2 selon le type de backup
  if [[ "$FILENAME" == *.sql.gz ]]; then
    REMOTE_SUBDIR="pg"
  elif [[ "$FILENAME" == *.tar.gz ]]; then
    REMOTE_SUBDIR="minio"
  else
    log "  Type de fichier non reconnu — ignoré: $FILENAME"
    continue
  fi

  YEAR="$(date -u '+%Y')"
  MONTH="$(date -u '+%m')"
  REMOTE_PATH="${REMOTE_SUBDIR}/${YEAR}/${MONTH}"
  ENCRYPTED_FILENAME="${FILENAME}.age"

  # Nettoyage des fichiers intermédiaires sur erreur inattendue
  _file_cleanup() {
    [[ -f "$ENCRYPTED_TEMP" ]] && rm -f "$ENCRYPTED_TEMP" || true
    [[ -f "$ENCRYPTED_FILE" ]] && rm -f "$ENCRYPTED_FILE" || true
  }
  trap _file_cleanup EXIT

  # ── 0. Vérification taille plaintext (refus si vide) ────────────────────────
  PLAINTEXT_SIZE="$(wc -c < "$PLAINTEXT_FILE")"
  if (( PLAINTEXT_SIZE == 0 )); then
    log "  ERREUR: Fichier plaintext vide (0 bytes) — backup raté ? Abandon."
    FAILED=$(( FAILED + 1 ))
    trap - EXIT
    continue
  fi

  # ── 1. SHA256 du fichier plaintext ──────────────────────────────────────────
  log "  1/5 SHA256 plaintext..."
  SHA256_HASH="$(sha256sum "$PLAINTEXT_FILE" | awk '{print $1}')"
  # Le manifest contiendra aussi le SHA256 du .age (ajouté après chiffrement)
  printf '%s  %s\n' "$SHA256_HASH" "$FILENAME" > "$SHA256_FILE"
  chmod 600 "$SHA256_FILE"
  log "  SHA256 plaintext: ${SHA256_HASH:0:16}... (${#SHA256_HASH} chars)"

  # ── 2. Chiffrement age (asymétrique — aucune passphrase interactive) ────────
  log "  2/5 Chiffrement age..."
  # SÉCURITÉ : BACKUP_AGE_RECIPIENT est la clé PUBLIQUE — safe dans les logs
  # Ne jamais logger BACKUP_AGE_IDENTITY (clé privée) — elle n'est de toute façon pas sur le VPS
  AGE_EXIT=0
  AGE_STDERR="$(mktemp)"
  age -r "$BACKUP_AGE_RECIPIENT" -o "$ENCRYPTED_TEMP" "$PLAINTEXT_FILE" \
    2>"$AGE_STDERR" || AGE_EXIT=$?
  if [[ $AGE_EXIT -ne 0 ]]; then
    log "  ERREUR: Chiffrement age échoué (code: $AGE_EXIT)"
    # Lire l'erreur sans echo de la clé
    grep -v 'age1\|recipient\|identity' "$AGE_STDERR" 2>/dev/null | \
      while IFS= read -r line; do log "  age: $line"; done || true
    rm -f "$AGE_STDERR" "$ENCRYPTED_TEMP"
    FAILED=$(( FAILED + 1 ))
    trap - EXIT
    continue
  fi
  rm -f "$AGE_STDERR"

  ENCRYPTED_SIZE="$(wc -c < "$ENCRYPTED_TEMP")"
  # Le fichier chiffré doit avoir une taille raisonnable (header age ~100 bytes + payload)
  if (( ENCRYPTED_SIZE < 100 )); then
    log "  ERREUR: Fichier chiffré anormalement petit (${ENCRYPTED_SIZE} bytes). Abandon."
    rm -f "$ENCRYPTED_TEMP"
    FAILED=$(( FAILED + 1 ))
    trap - EXIT
    continue
  fi

  # P0-FIX : renommer localement .age.tmp → .age avant upload
  # rclone copy préserve le basename — uploader .tmp uploadait "file.age.tmp" sur R2
  mv "$ENCRYPTED_TEMP" "$ENCRYPTED_FILE"

  # SHA256 du fichier .age — vérifiable sans clé privée lors du restore test
  SHA256_AGE="$(sha256sum "$ENCRYPTED_FILE" | awk '{print $1}')"
  printf '%s  %s\n' "$SHA256_AGE" "$ENCRYPTED_FILENAME" >> "$SHA256_FILE"
  log "  Chiffrement OK (${PLAINTEXT_SIZE} → ${ENCRYPTED_SIZE} bytes), SHA256 .age: ${SHA256_AGE:0:16}..."

  # ── 3. Upload R2 avec vérification de checksum ──────────────────────────────
  log "  3/5 Upload R2: ${RCLONE_REMOTE}:${R2_BUCKET}/${REMOTE_PATH}/"
  RCLONE_LOG="$(mktemp)"
  UPLOAD_EXIT=0
  # P0-FIX : on uploade $ENCRYPTED_FILE (.age) — le nom final, pas .age.tmp
  timeout "$RCLONE_TIMEOUT" rclone copy \
    "$ENCRYPTED_FILE" \
    "${RCLONE_REMOTE}:${R2_BUCKET}/${REMOTE_PATH}/" \
    --s3-chunk-size 64M \
    --transfers 1 \
    --retries 3 \
    --retry-wait 10 \
    --checksum \
    > "$RCLONE_LOG" 2>&1 || UPLOAD_EXIT=$?

  if [[ $UPLOAD_EXIT -ne 0 ]]; then
    log "  ERREUR: Upload rclone échoué (code: $UPLOAD_EXIT)"
    tail -20 "$RCLONE_LOG" | while IFS= read -r line; do log "  rclone: $line"; done
    rm -f "$RCLONE_LOG" "$ENCRYPTED_FILE"
    FAILED=$(( FAILED + 1 ))
    trap - EXIT
    continue
  fi
  rm -f "$RCLONE_LOG"
  log "  Upload OK"

  # ── 4. Vérification existence sur R2 ────────────────────────────────────────
  log "  4/5 Vérification existence R2..."
  REMOTE_FILE_PATH="${REMOTE_PATH}/${ENCRYPTED_FILENAME}"
  REMOTE_SIZE=0
  REMOTE_SIZE="$(timeout 30 rclone size \
    "${RCLONE_REMOTE}:${R2_BUCKET}/${REMOTE_FILE_PATH}" \
    --json 2>/dev/null | grep -o '"bytes":[0-9]*' | grep -o '[0-9]*' || echo "0")"

  if [[ "$REMOTE_SIZE" == "0" || -z "$REMOTE_SIZE" ]]; then
    log "  ERREUR CRITIQUE: Fichier absent ou vide sur R2 après upload."
    rm -f "$ENCRYPTED_FILE"
    FAILED=$(( FAILED + 1 ))
    trap - EXIT
    send_alert emergency \
      "Upload R2 INTROUVABLE après upload : $FILENAME — vérifier R2 manuellement." \
      "r2-upload-missing"
    continue
  fi
  log "  Présent sur R2 (${REMOTE_SIZE} bytes)"

  # ── 5. Upload SHA256 manifest + nettoyage ───────────────────────────────────
  log "  5/5 Upload SHA256 manifest + nettoyage..."
  timeout 60 rclone copy \
    "$SHA256_FILE" \
    "${RCLONE_REMOTE}:${R2_BUCKET}/${REMOTE_PATH}/" \
    --retries 2 --timeout 30 \
    2>/dev/null || log "  AVERTISSEMENT: Upload SHA256 manifest échoué (non bloquant)"

  # Supprimer le fichier .age local (R2 est la copie distante de référence)
  rm -f "$ENCRYPTED_FILE"
  trap - EXIT

  # Marqueur : ne plus essayer d'uploader ce fichier lors des prochaines exécutions
  touch "${PLAINTEXT_FILE}.r2"
  chmod 600 "${PLAINTEXT_FILE}.r2"

  log "  === OK: $FILENAME → ${RCLONE_REMOTE}:${R2_BUCKET}/${REMOTE_FILE_PATH} ==="
  UPLOADED=$(( UPLOADED + 1 ))
done

# ─── Résumé + alertes ─────────────────────────────────────────────────────────
log "=== Terminé: ${UPLOADED} uploadé(s), ${FAILED} échec(s) ==="

if [[ $FAILED -gt 0 && $UPLOADED -eq 0 ]]; then
  send_alert emergency \
    "Backup R2 : ${FAILED} fichier(s) non uploadé(s). Backups locaux OK mais distants MANQUANTS." \
    "r2-upload-failed"
  exit 1
elif [[ $FAILED -gt 0 ]]; then
  send_alert critical \
    "Backup R2 partiel : ${UPLOADED} OK, ${FAILED} échec(s). Vérifier les logs encrypt-upload." \
    "r2-upload-partial"
  exit 1
elif [[ $UPLOADED -gt 0 ]]; then
  send_alert ok \
    "Backup R2 : ${UPLOADED} fichier(s) chiffré(s) et uploadé(s) avec succès." \
    "r2-upload-ok"
fi

trap - EXIT
