# Page admin « État système » (cockpit pré-prod)

Cockpit en lecture seule pour l'admin : readiness infra, fraîcheur des
sauvegardes, usage disque, version déployée, compteurs d'alertes.

- **UI** : [`/admin/health`](../../apps/web/app/admin/health/page.tsx)
- **API** : `GET /admin/system-status` ([admin.controller.ts](../../apps/api/src/modules/admin/admin.controller.ts)) →
  [`system-status.service.ts`](../../apps/api/src/modules/admin/system-status.service.ts)

## Sécurité

- **Admin uniquement**, server-side : `requirePermissions('system.monitor')`
  (AuthN + AuthZ ; non-connecté → 401, non-admin → 403).
- `Cache-Control: no-store` — jamais de cache CDN/proxy.
- **Aucune** écriture DB (lecture seule ; GAP-3 traitera les alertes).
- **Aucune fuite** : statuts/pourcentages uniquement. Jamais de chemin absolu,
  secret, string de connexion, stack trace. Le `filename` backup est réduit au
  *basename*. En cas d'erreur : réponse neutre `500 {error:'Internal error'}`.

## Données affichées

| Bloc | Source | Statuts |
|------|--------|---------|
| Infrastructure | readiness GAP-1 (DB/Redis/storage) | ok / dégradé / critique / non configuré |
| Sauvegarde PostgreSQL | fichier d'état JSON (voir ci-dessous) | OK / WARN / CRITICAL / inconnu |
| Disque | `fs.statfs(DISK_MONITOR_PATH)` | OK <80 % · WARN 80–90 % · CRITICAL >90 % |
| Déploiement | `GIT_COMMIT_SHA` (court) + `DEPLOY_TIMESTAMP` | — |
| Alertes | `count(SystemAlert)` ouvertes / critiques | lien vers `/admin/alerts` |

## Fichier d'état backup (`last-backup.json`)

Produit par [`scripts/backup-pg.sh`](../../scripts/backup-pg.sh) (succès **et**
échec via trap), écrit atomiquement (`mv`), `chmod 600`. **Monté en lecture seule**
dans le conteneur API. L'API ne parcourt **jamais** le dossier de backups.

```json
{
  "status": "ok",
  "timestamp": "2026-06-13T02:00:00Z",
  "sizeBytes": 204800,
  "durationMs": 25,
  "sha256": "ba78…15ad",
  "filename": "blobsurf_vps_2026-06-13_020000_UTC.sql.gz"
}
```
Échec : `{ "status": "failed", "timestamp": "…", "errorCode": "BACKUP_FAILED" }`.

Champs autorisés uniquement : `status`, `timestamp`, `sizeBytes`, `sha256`,
`durationMs`, `filename` (basename), `errorCode`. **Aucun secret ni chemin complet.**
Lecture API bornée (taille max `BACKUP_STATE_MAX_BYTES`, timeout `SYSTEM_STATUS_IO_TIMEOUT_MS`,
schéma validé) ; fichier absent/illisible/invalide → état `unknown`, jamais de crash.

Dérivation santé backup : `failed` → CRITICAL ; âge > `BACKUP_MAX_AGE_CRITICAL_HOURS` →
CRITICAL ; âge > `BACKUP_MAX_AGE_WARN_HOURS` → WARN ; sinon OK.

### ⚠️ Permissions & montage RO (action VPS requise)

Le conteneur API tourne en **utilisateur `node` (UID 1000), non-root**
([docker/api.production.Dockerfile](../../docker/api.production.Dockerfile)). Le
backup, lui, tourne **sur l'hôte** via cron (souvent `root` ou un user de déploiement).

**Implémenté (GAP-3)** : `backup-pg.sh` écrit `last-backup.json` dans un **dossier
dédié** (`/var/lib/blob/status` par défaut, `755`, traversable par UID 1000), avec
le fichier en **`644`** — métadonnée admin-safe **sans secret**, distincte des dumps
`.sql.gz` qui restent isolés en `600`/`700`. Le dossier est monté **lecture seule**
dans le conteneur API (`docker-compose.{vps,blobsurf}.yml`).

```bash
# hôte VPS — une seule fois
install -d -m 755 /var/lib/blob/status
# cron backup : BACKUP_STATE_FILE=/var/lib/blob/status/last-backup.json
```
```yaml
# docker-compose.vps.yml — service api (déjà ajouté)
volumes:
  - /var/lib/blob/status:/var/lib/blob/status:ro
```

**Alternative durcie (least-privilege)** — si tu préfères ne pas laisser le fichier
en `644` : `640` + groupe dédié `blobstatus`, et le conteneur API lancé avec ce **GID**
en groupe supplémentaire (`group_add: ["<gid>"]`). Coordination GID requise ;
**ne pas appliquer sans valider le GID en prod**. Le code n'impose pas ce durcissement.

## Variables d'environnement

| Variable | Défaut | Rôle |
|----------|--------|------|
| `BACKUP_STATE_FILE` | `/var/lib/blob/status/last-backup.json` | Chemin du JSON d'état (côté script ET côté API, identiques via montage RO) |
| `BACKUP_STATE_MAX_BYTES` | `4096` | Taille max lue (borné 256–65536) |
| `BACKUP_MAX_AGE_WARN_HOURS` | `26` | Seuil WARN d'âge backup |
| `BACKUP_MAX_AGE_CRITICAL_HOURS` | `50` | Seuil CRITICAL d'âge backup |
| `DISK_MONITOR_PATH` | `/` | Chemin mesuré par statfs (jamais exposé en réponse) |
| `DISK_WARN_PERCENT` / `DISK_CRITICAL_PERCENT` | `80` / `90` | Seuils disque |
| `SYSTEM_STATUS_IO_TIMEOUT_MS` | `1500` | Timeout des lectures IO (borné 200–5000) |
| `GIT_COMMIT_SHA` (ou `COMMIT_SHA`) | — | SHA injecté au build/deploy (affiché court ; `unknown` si absent/non-hex) |
| `DEPLOY_TIMESTAMP` | — | Date de déploiement (ISO) |

## Vérifier

```bash
curl -s -H "Authorization: Bearer <ADMIN_JWT>" http://localhost:4000/admin/system-status | jq
NODE_ENV=test pnpm --filter @blobinfini/api exec jest --testPathPatterns "system-status"
```

## En cas d'échec

| Symptôme | Cause | Action |
|----------|-------|--------|
| Backup `WARN`/`CRITICAL` (âge) | cron backup en retard/mort | vérifier le cron VPS, relancer `scripts/backup-pg.sh`, valider via `scripts/restore-pg.sh` |
| Backup `CRITICAL` (`failed`) | dernier run en erreur | consulter les logs du cron ; `errorCode` générique côté admin |
| Backup `inconnu` | fichier d'état absent/non monté | vérifier le montage RO du volume et `BACKUP_STATE_FILE` |
| Disque `CRITICAL` | volume presque plein | purge/rotation, agrandir le volume ; voir rétention backups |
| Commit `unknown` | `GIT_COMMIT_SHA` non injecté au deploy | renseigner la variable dans le pipeline de déploiement |

## Limites connues

- Pas d'historique/tendance : photo instantanée. L'historique d'incidents vit
  dans les alertes (`/admin/alerts`).
- La surveillance automatique du backup (absent/échoué/obsolète → SystemAlert +
  email) est gérée par le job cron — voir [system-alerts.md](./system-alerts.md).
