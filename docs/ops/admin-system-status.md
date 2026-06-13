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

Par défaut, `backup-pg.sh` écrit `last-backup.json` en **`chmod 600`** (owner only)
**à l'intérieur du dossier de dumps en `chmod 700`**. Tel quel, **UID 1000 ne peut
PAS lire le fichier** → la carte backup afficherait `inconnu`. Le fichier d'état ne
contient **aucun secret** (contrairement aux dumps `.sql.gz`), donc on peut le rendre
lisible par l'API sans risque. Trois options, par ordre de préférence :

1. **Dossier d'état dédié + montage RO** (recommandé) — sortir le fichier d'état du
   dossier 700 des dumps :
   ```bash
   # hôte
   install -d -m 755 /var/lib/blob/status
   # cron : BACKUP_STATE_FILE=/var/lib/blob/status/last-backup.json
   ```
   ```yaml
   # docker-compose.vps.yml — service api
   volumes:
     - /var/lib/blob/status/last-backup.json:/var/backups/blob/last-backup.json:ro
   ```
   Le fichier reste métadonnée non sensible ; le dossier `755` est traversable par
   UID 1000, les dumps `.sql.gz` restent isolés en `700`.

2. **`640` + groupe dédié** — si tu veux garder l'état dans le dossier des dumps :
   créer un groupe `blobstatus`, `chgrp blobstatus last-backup.json && chmod 640`,
   et faire tourner le conteneur API avec ce **GID** en groupe supplémentaire
   (`group_add: ["<gid_blobstatus>"]` dans compose). Plus de coordination GID, mais
   les dumps peuvent rester co-localisés. **Ne pas appliquer sans valider le GID en prod.**

3. **Même UID** — faire écrire le cron par UID 1000. Fragile, déconseillé.

> Le script conserve volontairement `chmod 600` (défaut sûr, cohérent avec les dumps).
> Le choix d'assouplissement (option 1 ou 2) est une **décision ops** à acter sur VPS ;
> aucun changement de permissions n'est imposé par le code.

## Variables d'environnement

| Variable | Défaut | Rôle |
|----------|--------|------|
| `BACKUP_STATE_FILE` | `/var/backups/blob/last-backup.json` | Chemin du JSON d'état (côté script ET côté API, identiques via montage RO) |
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
- La création d'alertes automatiques sur backup absent/échoué (SystemAlert +
  notification) **n'est pas** dans ce périmètre — c'est GAP-3.
