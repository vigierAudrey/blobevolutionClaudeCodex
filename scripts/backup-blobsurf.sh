#!/usr/bin/env bash
# scripts/backup-blobsurf.sh — Sauvegarde PostgreSQL BlobSurf (bêta privée VPS)
#
# Wrapper minimal autour de backup-pg.sh avec les defaults blobsurf.
#
# Usage :
#   ./scripts/backup-blobsurf.sh
#   ./scripts/backup-blobsurf.sh --backup-dir /data/backups/blobsurf
#
# Variables d'environnement surchargeables :
#   ENV_FILE     (défaut: /home/audrey/blob-app/.env.vps)
#   BACKUP_DIR   (défaut: $HOME/backups/blobsurf)
#
# Cron recommandé (3h du matin, UTC) :
#   0 3 * * * DC_PROJECT=blobconnect-vps \
#             ENV_FILE=/home/audrey/blob-app/.env.vps \
#             BACKUP_DIR=$HOME/backups/blobsurf \
#             BACKUP_PREFIX=blobsurf_vps \
#             /home/audrey/blob-app/scripts/backup-blobsurf.sh \
#             >> $HOME/backups/blobsurf/cron.log 2>&1
#
# Validation du dernier backup :
#   ./scripts/restore-blobsurf.sh $HOME/backups/blobsurf/<dernier_fichier>.sql.gz
#
# ─── Sécurité ─────────────────────────────────────────────────────────────────
# Vérification que ENV_FILE existe — refus si absent.
ENV_FILE="${ENV_FILE:-/home/audrey/blob-app/.env.vps}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') [backup-blobsurf] ERREUR: ENV_FILE introuvable: $ENV_FILE" >&2
  echo "  → Copier .env.blobsurf.example vers .env.vps et remplir les valeurs." >&2
  exit 1
fi

DC_PROJECT="${DC_PROJECT:-blobconnect-vps}" \
ENV_FILE="$ENV_FILE" \
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/blobsurf}" \
BACKUP_PREFIX=blobsurf_vps \
  exec "$(dirname "$0")/backup-pg.sh" "$@"
