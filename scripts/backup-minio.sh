#!/usr/bin/env bash
# scripts/backup-minio.sh — Sauvegarde MinIO (stockage objet) BlobConnect/BlobSurf
#
# Méthode : archive tar.gz du VOLUME Docker MinIO via un conteneur éphémère
# monté en LECTURE SEULE (`--volumes-from <minio>:ro`). Le flux tar est écrit
# sur le stdout du conteneur puis compressé côté hôte → le fichier appartient à
# l'utilisateur cron (pas à root) et AUCUN credential MinIO n'est nécessaire.
#
# Pourquoi cette méthode (vs `mc mirror`) :
#   - ZÉRO secret : aucune clé S3/MinIO n'est lue ni passée à `docker run -e`
#     (qui serait visible dans `ps` côté hôte pour un job cron récurrent).
#   - Restore fidèle : l'archive contient TOUT l'état disque, y compris
#     `.minio.sys` (buckets, policies, IAM, versioning). Restore = extraction.
#   - Produit un `.tar.gz` que backup-encrypt-upload.sh route déjà vers `minio/`.
#   Compromis assumé (P2) : tar au niveau filesystem n'est pas un snapshot
#   atomique. MinIO écrit les objets de façon atomique (temp + rename), donc une
#   archive prise en fenêtre faible charge (cron 4h UTC) est cohérente par objet ;
#   au pire une métadonnée `.minio.sys` en cours d'écriture. Pour une cohérence
#   point-in-time stricte il faudrait suspendre les writes — INTERDIT ici (prod).
#
# Usage :
#   ./scripts/backup-minio.sh [--dry-run] [--backup-dir PATH] [--help]
#
# Variables d'environnement (overrides) :
#   DC_PROJECT                   Projet docker compose      (défaut: blobconnect-vps)
#   BACKUP_DIR                   Dossier des archives        (défaut: $HOME/backups/blobsurf/minio)
#   MINIO_BACKUP_PREFIX          Préfixe nom de fichier/glob (défaut: blobsurf_minio)
#   MINIO_CONTAINER              Nom exact du conteneur MinIO (sinon auto-détecté)
#   MINIO_BACKUP_RETENTION_DAYS  Rotation en jours           (défaut: 7)
#   MINIO_BACKUP_MIN_BYTES       Taille min de l'archive     (défaut: 512)
#   BACKUP_HELPER_IMAGE          Image tar éphémère          (défaut: busybox:stable)
#   LOCK_FILE                    Verrou flock                (défaut: /tmp/blob-backup-minio.lock)
#   ENV_FILE                     Accepté pour parité cron — NON lu (aucun secret requis).
#
# Sortie : $BACKUP_DIR/<prefix>_YYYY-MM-DD_HHMMSS_UTC.tar.gz (+ .sha256)
#
# Sécurité : archive chmod 600 dans un dossier chmod 700 (jamais public), hors repo
# git ; aucun secret en log ; rotation bornée par préfixe ; --dry-run ne crée ni ne
# supprime rien. Ce script ne lance JAMAIS de restore ni de suppression MinIO.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ─── Configuration (toutes surchargeables par variable d'environnement) ───────
DC_PROJECT="${DC_PROJECT:-blobconnect-vps}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/blobsurf/minio}"
MINIO_BACKUP_PREFIX="${MINIO_BACKUP_PREFIX:-blobsurf_minio}"
MINIO_CONTAINER="${MINIO_CONTAINER:-}"
MINIO_BACKUP_RETENTION_DAYS="${MINIO_BACKUP_RETENTION_DAYS:-7}"
MINIO_BACKUP_MIN_BYTES="${MINIO_BACKUP_MIN_BYTES:-512}"
BACKUP_HELPER_IMAGE="${BACKUP_HELPER_IMAGE:-busybox:stable}"
LOCK_FILE="${LOCK_FILE:-/tmp/blob-backup-minio.lock}"
COMPOSE_FILE="${COMPOSE_FILE:-$REPO_ROOT/docker-compose.vps.yml}"
DRY_RUN=0

ts()  { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
log() { echo "$(ts) [backup-minio] $*"; }
die() { echo "$(ts) [backup-minio] ERREUR FATALE: $*" >&2; exit 1; }

usage() {
  sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

# ─── Arguments ────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)    DRY_RUN=1;        shift ;;
    --backup-dir) BACKUP_DIR="$2";  shift 2 ;;
    -h|--help)    usage; exit 0 ;;
    *) die "Argument inconnu: $1 (voir --help)" ;;
  esac
done

[[ "$DRY_RUN" -eq 1 ]] && log "=== MODE DRY-RUN : aucune archive créée, aucune suppression ==="
log "=== Backup MinIO ($DC_PROJECT) ==="

# ─── Pré-requis : compose file + docker ──────────────────────────────────────
# On exige le compose file (lancé depuis le repo) pour éviter une exécution
# hors contexte. La présence du fichier garantit qu'on cible la bonne stack.
[[ -f "$COMPOSE_FILE" ]] \
  || die "Compose file introuvable: $COMPOSE_FILE
       Lancer ce script depuis le repo, ou définir COMPOSE_FILE."

command -v docker >/dev/null 2>&1 \
  || die "Client 'docker' indisponible — méthode de backup impossible."

# ─── BACKUP_DIR interdit dans le repo (risque commit de données) ──────────────
BACKUP_DIR_ABS="$(realpath -m "$BACKUP_DIR")"
REPO_ROOT_ABS="$(realpath "$REPO_ROOT")"
if [[ "$BACKUP_DIR_ABS" == "$REPO_ROOT_ABS"* ]]; then
  die "SÉCURITÉ: BACKUP_DIR ($BACKUP_DIR_ABS) est dans le repo git.
       Utiliser un chemin hors du repo. Ex: BACKUP_DIR=\$HOME/backups/blobsurf/minio"
fi

# ─── Détection du conteneur MinIO ────────────────────────────────────────────
if [[ -z "$MINIO_CONTAINER" ]]; then
  MINIO_CONTAINER=$(docker ps \
    --filter "name=${DC_PROJECT}-minio" \
    --filter "status=running" \
    --format "{{.Names}}" | head -1)
fi

[[ -n "$MINIO_CONTAINER" ]] || die "Container MinIO introuvable ou arrêté.
       Vérifier: docker ps --filter 'name=${DC_PROJECT}-minio'
       (ou définir MINIO_CONTAINER=<nom> explicitement)."

docker ps --filter "name=^/${MINIO_CONTAINER}$" --filter "status=running" \
  --format '{{.Names}}' | grep -qx "$MINIO_CONTAINER" \
  || die "Container MinIO '$MINIO_CONTAINER' non démarré."

log "Container MinIO: $MINIO_CONTAINER"

# ─── Vérifier que /data est bien monté (sinon l'archive serait vide) ──────────
DATA_MOUNT=$(docker inspect -f \
  '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Destination}}{{end}}{{end}}' \
  "$MINIO_CONTAINER" 2>/dev/null || true)
[[ "$DATA_MOUNT" == "/data" ]] \
  || die "Le conteneur '$MINIO_CONTAINER' n'expose pas de volume sur /data — backup impossible."

# ─── flock anti-concurrence ──────────────────────────────────────────────────
exec 200>"$LOCK_FILE" || die "Impossible d'ouvrir le verrou: $LOCK_FILE"
if ! flock -n 200; then
  die "Un autre backup MinIO est déjà en cours (verrou: $LOCK_FILE). Abandon."
fi

# ─── Nommage horodaté ─────────────────────────────────────────────────────────
TIMESTAMP=$(date -u '+%Y-%m-%d_%H%M%S_UTC')
BACKUP_FILE="$BACKUP_DIR_ABS/${MINIO_BACKUP_PREFIX}_${TIMESTAMP}.tar.gz"
BACKUP_TEMP="${BACKUP_FILE}.tmp"
SHA_FILE="${BACKUP_FILE}.sha256"

# ─── DRY-RUN : on s'arrête ici, rien n'est créé ni supprimé ───────────────────
if [[ "$DRY_RUN" -eq 1 ]]; then
  log "Méthode      : tar.gz du volume /data via '$BACKUP_HELPER_IMAGE' (--volumes-from ${MINIO_CONTAINER}:ro)"
  log "Destination  : $BACKUP_FILE (NON créée en dry-run)"
  log "Checksum     : $SHA_FILE (NON créé en dry-run)"
  log "Rotation     : archives ${MINIO_BACKUP_PREFIX}_*.tar.gz > ${MINIO_BACKUP_RETENTION_DAYS}j seraient supprimées (aucune suppression en dry-run)"
  if [[ -d "$BACKUP_DIR_ABS" ]]; then
    CANDIDATES=$(find "$BACKUP_DIR_ABS" -maxdepth 1 -name "${MINIO_BACKUP_PREFIX}_*.tar.gz" \
      -mtime +"$MINIO_BACKUP_RETENTION_DAYS" 2>/dev/null | wc -l | tr -d ' ')
    log "Candidats rotation actuels : $CANDIDATES"
  fi
  log "=== DRY-RUN terminé : aucune écriture, aucune suppression ==="
  exit 0
fi

# ─── Répertoire de backup (chmod 700 : données sensibles, jamais public) ──────
mkdir -p "$BACKUP_DIR_ABS"
chmod 700 "$BACKUP_DIR_ABS"

log "Destination: $BACKUP_FILE"

# ─── Nettoyage automatique sur erreur ─────────────────────────────────────────
_cleanup() {
  local code=$?
  [[ -f "$BACKUP_TEMP" ]] && rm -f "$BACKUP_TEMP"
  [[ $code -ne 0 ]] && log "Sortie sur erreur (code: $code)"
}
trap _cleanup EXIT

# ─── Archive : tar du volume en lecture seule via conteneur éphémère ──────────
# `--volumes-from <minio>:ro` : monte le volume /data en LECTURE SEULE → aucun
# risque de modification des données MinIO. tar écrit sur stdout (pas de -t),
# compression gzip côté hôte → fichier possédé par l'utilisateur cron.
# pipefail garantit qu'un échec docker/tar fait échouer le script.
log "Archivage de /data (lecture seule)..."
docker run --rm \
  --volumes-from "${MINIO_CONTAINER}:ro" \
  --network none \
  "$BACKUP_HELPER_IMAGE" \
  tar cf - -C /data . \
  | gzip -9 > "$BACKUP_TEMP" \
  || die "Échec de l'archivage tar (image '$BACKUP_HELPER_IMAGE' indisponible ?
       Essayer: docker pull $BACKUP_HELPER_IMAGE — ou définir BACKUP_HELPER_IMAGE)."

# ─── Validation ───────────────────────────────────────────────────────────────
[[ -f "$BACKUP_TEMP" ]] || die "Archive temporaire absente après tar — échec silencieux."

BACKUP_SIZE=$(wc -c < "$BACKUP_TEMP")
(( BACKUP_SIZE >= MINIO_BACKUP_MIN_BYTES )) \
  || die "FAIL-FAST: archive trop petite (${BACKUP_SIZE} bytes < ${MINIO_BACKUP_MIN_BYTES} min).
       Volume probablement vide ou non monté."

gzip --test "$BACKUP_TEMP" 2>/dev/null \
  || die "FAIL-FAST: intégrité gzip échouée — vérifier l'espace disque."

log "Validation: ${BACKUP_SIZE} bytes, gzip OK"

# ─── Promotion atomique + permissions restrictives ───────────────────────────
mv "$BACKUP_TEMP" "$BACKUP_FILE"
chmod 600 "$BACKUP_FILE"

# ─── Checksum SHA256 (sidecar, perms restrictives) ────────────────────────────
SHA256=""
if command -v sha256sum >/dev/null 2>&1; then
  SHA256="$(sha256sum "$BACKUP_FILE" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  SHA256="$(shasum -a 256 "$BACKUP_FILE" | awk '{print $1}')"
fi
if [[ -n "$SHA256" ]]; then
  printf '%s  %s\n' "$SHA256" "$(basename "$BACKUP_FILE")" > "$SHA_FILE"
  chmod 600 "$SHA_FILE"
else
  log "AVERTISSEMENT: ni sha256sum ni shasum disponibles — checksum non généré."
fi

log "Backup: $(basename "$BACKUP_FILE") ($(stat -c '%a %U:%G' "$BACKUP_FILE" 2>/dev/null || echo 'perms n/a'))"

# ─── Rotation (bornée par préfixe — ne supprime QUE nos archives) ─────────────
DELETED=0
while IFS= read -r -d '' old; do
  log "Rotation: suppression de $(basename "$old")"
  rm -f "$old" "${old}.sha256"
  (( DELETED++ )) || true
done < <(find "$BACKUP_DIR_ABS" -maxdepth 1 \
           -name "${MINIO_BACKUP_PREFIX}_*.tar.gz" \
           -mtime +"$MINIO_BACKUP_RETENTION_DAYS" -print0 2>/dev/null)

REMAINING=$(find "$BACKUP_DIR_ABS" -maxdepth 1 -name "${MINIO_BACKUP_PREFIX}_*.tar.gz" | wc -l | tr -d ' ')

log "=== Backup MinIO terminé avec succès ==="
log "  Fichier   : $BACKUP_FILE"
log "  Taille    : ${BACKUP_SIZE} bytes"
log "  Conservés : $REMAINING (rotation: $DELETED supprimé(s), rétention ${MINIO_BACKUP_RETENTION_DAYS}j)"
[[ -n "$SHA256" ]] && log "  SHA256    : $SHA256"

trap - EXIT
