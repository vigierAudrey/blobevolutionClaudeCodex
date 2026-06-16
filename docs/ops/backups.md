# Sauvegardes PostgreSQL

Vue consolidée des sauvegardes : scripts, état admin, surveillance, restauration.

## Scripts

| Script | Rôle |
|--------|------|
| [`scripts/backup-pg.sh`](../../scripts/backup-pg.sh) | Dump PostgreSQL (pré-VPS), validation, rotation, écrit `last-backup.json` |
| [`scripts/backup-blobsurf.sh`](../../scripts/backup-blobsurf.sh) | Variante stack blobsurf |
| [`scripts/restore-pg.sh`](../../scripts/restore-pg.sh) | Restauration **dry-run** (container éphémère) — voir [restore-drill](./restore-drill.md) |
| [`scripts/restore-postgres-drill.sh`](../../scripts/restore-postgres-drill.sh) | Restore drill vers une base **staging/temp désignée** (`RESTORE_TARGET_DATABASE_URL`), garde-fous anti-prod + `--verify` — voir [restore-drill](./restore-drill.md) |
| [`scripts/backup-minio.sh`](../../scripts/backup-minio.sh) | Archive `tar.gz` du volume MinIO (objets + métadonnées), validation, rotation — voir [§ MinIO](#sauvegarde-minio-stockage-objet) |
| [`scripts/backup-encrypt-upload.sh`](../../scripts/backup-encrypt-upload.sh) | Chiffrement age + upload R2 (reprend les `*.tar.gz` MinIO → R2 `minio/`) |

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

## Sauvegarde MinIO (stockage objet)

[`scripts/backup-minio.sh`](../../scripts/backup-minio.sh) archive le **volume Docker
MinIO** (`/data`) via un conteneur éphémère monté en **lecture seule**
(`--volumes-from <minio>:ro`). Le flux `tar` est compressé côté hôte → l'archive
appartient à l'utilisateur cron et **aucun credential MinIO n'est lu ni exposé**.
L'archive contient l'état disque complet, y compris `.minio.sys` (buckets,
policies, IAM, versioning) — restore = simple extraction dans un volume.

**Pourquoi cette méthode plutôt que `mc mirror`** : zéro secret (mirror exigerait
d'injecter la clé root dans `docker run -e`, visible dans `ps`), restore fidèle, et
production directe d'un `.tar.gz` repris par `backup-encrypt-upload.sh`.
**Compromis (P2)** : tar filesystem non-atomique ; MinIO écrit les objets
atomiquement, donc une archive en fenêtre faible charge (cron 4h UTC) est cohérente
par objet. Pas de quiesce des writes (interdit en prod).

```bash
# Dry-run (ne crée NI archive NI suppression) — à lancer en premier
DC_PROJECT=blobconnect-vps BACKUP_DIR=$HOME/backups/blobsurf/minio \
  ./scripts/backup-minio.sh --dry-run

# Backup manuel réel
DC_PROJECT=blobconnect-vps BACKUP_DIR=$HOME/backups/blobsurf/minio \
  ./scripts/backup-minio.sh
```

| Variable | Défaut | Rôle |
|----------|--------|------|
| `DC_PROJECT` | `blobconnect-vps` | Projet compose (auto-détection du conteneur `…-minio`) |
| `BACKUP_DIR` | `$HOME/backups/blobsurf/minio` | Dossier des archives (hors repo, `700`) |
| `MINIO_BACKUP_PREFIX` | `blobsurf_minio` | Préfixe nom de fichier/glob de rotation |
| `MINIO_CONTAINER` | _(auto)_ | Nom exact du conteneur si l'auto-détection échoue |
| `MINIO_BACKUP_RETENTION_DAYS` | `7` | Rotation (ne supprime que `<prefix>_*.tar.gz`) |
| `MINIO_BACKUP_GZIP_LEVEL` | `6` | Niveau gzip (médias déjà compressés → `-9` peu utile, plus coûteux CPU) |
| `BACKUP_HELPER_IMAGE` | `busybox:stable` | Image fournissant `tar` |

> **Cron** : la ligne MinIO de [`cron-blobsurf.cron`](./cron-blobsurf.cron) est
> volontairement **commentée** — à activer seulement après un premier run manuel
> validé sur le VPS.
>
> **Restore MinIO** : à documenter séparément (procédure d'extraction de l'archive
> dans un volume sur une stack de test). Non couvert par cette PR.

## Procédures

- **Tester un backup sans toucher la prod** → [restore-drill.md](./restore-drill.md).
- **Incident « backup CRITICAL »** → [system-alerts.md § procédure](./system-alerts.md#procédure-si-alerte-backup-critical).
- **DB down** → vérifier le conteneur postgres / `pg_isready` ; `/health/ready`
  passe `critical` (503) tant que la DB ne répond pas ([healthchecks.md](./healthchecks.md)).
- **Disque plein** → rotation/purge, agrandir le volume ; surveillé par le cockpit admin.
