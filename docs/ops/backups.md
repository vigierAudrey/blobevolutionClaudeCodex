# Sauvegardes PostgreSQL

Vue consolidée des sauvegardes : scripts, état admin, surveillance, restauration.

## Scripts

| Script | Rôle |
|--------|------|
| [`scripts/backup-pg.sh`](../../scripts/backup-pg.sh) | Dump PostgreSQL (pré-VPS), validation, rotation, écrit `last-backup.json` |
| [`scripts/backup-blobsurf.sh`](../../scripts/backup-blobsurf.sh) | Variante stack blobsurf |
| [`scripts/restore-pg.sh`](../../scripts/restore-pg.sh) | Restauration **dry-run** (container éphémère) — voir [restore-drill](./restore-drill.md) |
| [`scripts/backup-encrypt-upload.sh`](../../scripts/backup-encrypt-upload.sh) | Chiffrement age + upload R2 |

Sécurité (déjà en place) : mot de passe via `.pgpass` éphémère (jamais en CLI/logs),
`mv` atomique, dump vide/corrompu → **fail-fast**, dumps en `chmod 600` dans un
dossier `chmod 700`, rotation `BACKUP_RETENTION_DAYS`. **Jamais** `prisma db push
--accept-data-loss` (garde-fous CI `ci-block-db-push.sh`, `no-unsafe-db-push-check.sh`).

## Fichier d'état admin (`last-backup.json`)

Écrit par `backup-pg.sh` (succès **et** échec), **dossier dédié** distinct des dumps,
fichier `644` (métadonnée admin-safe, **aucun secret**), monté **lecture seule** dans
l'API. Détail + permissions/montage : [admin-system-status.md](./admin-system-status.md).

```bash
# hôte VPS — une seule fois
install -d -m 755 /var/lib/blob/status
# cron backup : BACKUP_STATE_FILE=/var/lib/blob/status/last-backup.json
# compose api : volumes: - /var/lib/blob/status:/var/lib/blob/status:ro
```

## Surveillance

Un job cron lit cet état et lève une alerte admin si le backup est **absent,
échoué ou obsolète** → [system-alerts.md](./system-alerts.md).

## Variables d'environnement (backup)

| Variable | Défaut | Rôle |
|----------|--------|------|
| `BACKUP_DIR` | `$HOME/backups/blobconnect-prevps` | Dossier des dumps (hors repo, `700`) |
| `BACKUP_MIN_BYTES` | `1024` | Taille min du dump (fail-fast si en dessous) |
| `BACKUP_RETENTION_DAYS` | `7` | Rotation |
| `BACKUP_STATE_FILE` | `/var/lib/blob/status/last-backup.json` | Fichier d'état (RO côté API) |

## Procédures

- **Tester un backup sans toucher la prod** → [restore-drill.md](./restore-drill.md).
- **Incident « backup CRITICAL »** → [system-alerts.md § procédure](./system-alerts.md#procédure-si-alerte-backup-critical).
- **DB down** → vérifier le conteneur postgres / `pg_isready` ; `/health/ready`
  passe `critical` (503) tant que la DB ne répond pas ([healthchecks.md](./healthchecks.md)).
- **Disque plein** → rotation/purge, agrandir le volume ; surveillé par le cockpit admin.
