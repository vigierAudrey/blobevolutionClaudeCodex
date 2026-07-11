# Alertes système & surveillance backup (GAP-3)

Surveillance automatique de la **fraîcheur des sauvegardes PostgreSQL** →
alerte admin dédupliquée (+ notification email Brevo optionnelle). Affichage
dans le cockpit [admin "État système"](./admin-system-status.md) et la page
`/admin/alerts`.

## Vue d'ensemble

```
API in-process (30 min, prod) ──► backup-monitor.service
   ou CLI checkBackupFreshness.ts     │ lit last-backup.json (GAP-2, RO)
                                      ▼
                              SystemAlert (dedupeKey stable)
                                      │
                          ┌───────────┴───────────┐
                          ▼                       ▼
                  /admin/alerts (liste)   email Brevo (cooldown)
```

- **Aucune route HTTP** ne déclenche le job (zéro surface d'abus) — scheduler
  in-process de l'API (défaut en production) ou CLI/cron externe.
- **Idempotent** : `dedupeKey = backup.postgres.freshness`, type `BACKUP_FRESHNESS`.
  Une exécution répétée met à jour `lastSeenAt`/`occurrenceCount`, ne duplique jamais.
- L'API ne lit **que** `last-backup.json`, jamais les dumps.

## Détection → état d'alerte

| État backup (`last-backup.json`) | Gravité | Action alerte |
|----------------------------------|---------|---------------|
| OK & récent (< `BACKUP_MAX_AGE_WARN_HOURS`) | — | **résout** l'alerte ouverte si présente |
| Absent / illisible / JSON invalide | WARNING | crée/maj |
| Trop ancien (> WARN, ≤ CRITICAL) | WARNING | crée/maj |
| Trop ancien (> `BACKUP_MAX_AGE_CRITICAL_HOURS`) | CRITICAL | crée/maj |
| Dernier run `failed` | CRITICAL | crée/maj |

> Choix : « absent/invalide » = **WARNING** (on ne peut pas confirmer une perte —
> premier déploiement, montage absent…), « failed » et « trop ancien » = **CRITICAL**
> (problème confirmé). Résolution **automatique** au retour à OK (pas de bouton).

## Notification email (Brevo)

- Désactivée par défaut (`BACKUP_ALERT_EMAIL_ENABLED=false`). À activer seulement
  avec un SMTP réel (Brevo) configuré. **Jamais d'email réel en test** (mocké).
- Envoi **uniquement** sur : nouvelle alerte, escalade WARNING→CRITICAL, ou
  persistance CRITICAL après `BACKUP_ALERT_NOTIFY_COOLDOWN_HOURS` (cooldown
  persistant dans `metadata.lastNotifiedAt`).
- Email **admin-safe** : gravité, état, âge humanisé, code générique. **Aucun**
  filename de dump, chemin, secret. Destinataire `ADMIN_EMAIL`.

## SystemAlert (modèle)

`packages/database/prisma/schema.prisma` — réutilisé (pas de nouvelle table) :
`id, type, message, severity (INFO/WARNING/CRITICAL), status (OPEN/ACKNOWLEDGED/RESOLVED),
dedupeKey, metadata (JSON filtré, sans secret), occurrenceCount, firstSeenAt,
lastSeenAt, resolvedAt, createdAt, updatedAt`.
Index : `status`, **`status+severity`** (migration `20260613120000`), `type`,
`dedupeKey`, `createdAt`. Liste admin paginée (cap 100), select minimal, pas de N+1.

## Scheduler

**Par défaut (recommandé)** : le job tourne **in-process dans l'API** — le
conteneur API monte `/var/lib/blob/status` en lecture seule (compose VPS),
aucun node/pnpm requis sur l'hôte, rien à installer dans le crontab.

- `BACKUP_MONITOR_INTERVAL_MINUTES` : intervalle en minutes. Défaut : `30` si
  `NODE_ENV=production`, `0` (désactivé) sinon — en dev le fichier d'état
  n'existe pas et créerait une alerte WARNING parasite.
- Un run est déclenché au démarrage de l'API, puis à chaque intervalle.

**Alternative CLI** (run manuel ou cron externe, à protéger par `flock`) —
chemins alignés sur le VPS réel (`/home/audrey/blob-app`, user `audrey`,
cf. [cron-blobsurf.cron](./cron-blobsurf.cron)) :

```bash
cd /home/audrey/blob-app && ENV_FILE=/home/audrey/blob-app/.env.vps \
  pnpm --filter @blobinfini/api exec tsx src/jobs/checkBackupFreshness.ts
```

## Variables d'environnement

| Variable | Défaut | Rôle |
|----------|--------|------|
| `BACKUP_MONITOR_INTERVAL_MINUTES` | `30` en prod, `0` sinon | Intervalle du check in-process (0 = off) |
| `DISCORD_WEBHOOK_URL` | — | Canal Discord temps réel (partagé avec alert.sh). Actif dès que présent : WARNING/CRITICAL à la notification, `ok` à la résolution. Les violations de sécurité y passent aussi (message générique, zéro PII) |
| `ALERT_MIN_LEVEL` | `ok` | Filtre de niveau Discord partagé API + scripts (`ok`\|`warning`\|`critical`\|`emergency`) |
| `BACKUP_ALERT_EMAIL_ENABLED` | `false` | Active la notification email Brevo — **à mettre à `true` dans `.env.vps`**, sinon l'alerte reste silencieuse (DB/admin uniquement) |
| `BACKUP_ALERT_NOTIFY_COOLDOWN_HOURS` | `12` | Cooldown anti-spam (borné 1–168) |
| `ADMIN_EMAIL` | `security@blobsurf.com` | Destinataire des alertes |
| `BACKUP_MAX_AGE_WARN_HOURS` / `…_CRITICAL_HOURS` | `26` / `50` | Seuils d'âge (voir [admin-system-status](./admin-system-status.md)) |
| `BACKUP_STATE_FILE` | `/var/lib/blob/status/last-backup.json` | Source lue (RO) |

## Vérifier

```bash
# Forcer un run du job (lit last-backup.json, met à jour l'alerte)
ENV_FILE=.env.vps pnpm --filter @blobinfini/api exec ts-node src/jobs/checkBackupFreshness.ts

# Tests
NODE_ENV=test pnpm --filter @blobinfini/api exec jest --testPathPatterns "backup-monitor"
```

## Procédure si alerte backup CRITICAL

1. Ouvrir `/admin/health` → carte « Sauvegarde PostgreSQL » (état + âge).
2. Vérifier le cron de backup sur le VPS : `systemctl status cron`, `/var/log/blob/*`.
3. Relancer un backup : `scripts/backup-pg.sh` (ou `backup-blobsurf.sh`).
4. Valider l'intégrité : `scripts/restore-pg.sh <dump>` (dry-run, voir [restore-drill](./restore-drill.md)).
5. Au prochain run du moniteur (ou run manuel), l'alerte se **résout automatiquement**
   quand `last-backup.json` redevient OK.

## Limites connues

- Race entre deux runs concurrents → mitigée par `flock` (recommandé). Risque
  résiduel sans flock : double alerte transitoire (rare, non bloquant).
- Pas d'email de « récupération » (résolution silencieuse, visible dans l'UI).
