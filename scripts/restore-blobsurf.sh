#!/usr/bin/env bash
# scripts/restore-blobsurf.sh — Validation de backup BlobSurf (DRY-RUN uniquement)
#
# Wrapper autour de restore-pg.sh avec les defaults blobsurf.
# JAMAIS utilisé sur la DB de production — dry-run dans un container éphémère.
#
# Usage :
#   ./scripts/restore-blobsurf.sh <fichier.sql.gz>
#   ./scripts/restore-blobsurf.sh $HOME/backups/blobsurf/blobsurf_vps_2026-05-11_030000_UTC.sql.gz
#
# ─── Procédure de restore live blobsurf (NON automatisée — manuel uniquement) ──
#
# Étapes :
#   1. Valider le backup avec ce script (dry-run)
#   2. Arrêter les services :
#        docker compose -f docker-compose.blobsurf.yml stop api web caddy
#   3. Identifier le container postgres :
#        docker ps --filter "name=blobconnect-blobsurf-postgres"
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
#        docker compose -f docker-compose.blobsurf.yml up -d api web caddy
#   8. Appliquer les migrations éventuellement manquantes :
#        docker compose -f docker-compose.blobsurf.yml run --rm api \
#          sh -c "pnpm --filter @blobinfini/database exec prisma migrate deploy"
#   9. Valider : ./scripts/smoke-test-vps.sh
#
# ─── PROTECTION ANTI-ERREUR ───────────────────────────────────────────────────
# Ce script refuse d'opérer si ENV_FILE est absent.
# Il ne touche JAMAIS la base de production — container éphémère uniquement.

ENV_FILE="${ENV_FILE:-/home/audrey/blob-app/.env.vps}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') [restore-blobsurf] ERREUR: ENV_FILE introuvable: $ENV_FILE" >&2
  exit 1
fi

ENV_FILE="$ENV_FILE" exec "$(dirname "$0")/restore-pg.sh" "$@"
