# Test de restauration (restore drill)

**Objectif** : prouver qu'un backup PostgreSQL est **réellement restaurable**, sans
jamais toucher la base de production. Un backup jamais restauré n'est pas un backup.

Deux modèles complémentaires, tous deux non destructifs pour la prod :

| Modèle | Script | Cible | Quand |
|--------|--------|-------|-------|
| **Conteneur éphémère** | [`scripts/restore-pg.sh`](../../scripts/restore-pg.sh) | PostgreSQL jetable créé puis détruit par le script | Validation rapide, aucune infra requise hors Docker |
| **Base staging/temp désignée** | [`scripts/restore-postgres-drill.sh`](../../scripts/restore-postgres-drill.sh) | Base PostgreSQL **déjà existante** fournie via `RESTORE_TARGET_DATABASE_URL` | Drill vers un staging managé / instance temporaire, + vérif `_prisma_migrations` |

> ⚠️ **Interdit absolu en production** : `prisma db push --accept-data-loss`
> (bloqué en CI par [`ci-block-db-push.sh`](../../scripts/ci-block-db-push.sh) et
> [`no-unsafe-db-push-check.sh`](../../scripts/no-unsafe-db-push-check.sh)). Le restore
> *live* destructif (`DROP DATABASE`) reste **manuel**, jamais automatisé.

---

## Modèle A — conteneur éphémère (le plus simple)

```bash
# Lister les backups (hôte VPS)
ls -lh "$BACKUP_DIR"/*.sql.gz
# Valider le plus récent dans un conteneur jetable (détruit en fin de script)
ENV_FILE=.env.vps ./scripts/restore-pg.sh "$BACKUP_DIR/blobconnect_prevps_<...>.sql.gz"
```

Le script vérifie l'intégrité gzip (fail-fast), restaure dans un PostgreSQL éphémère,
compte les tables (`>= 5`), puis détruit le conteneur. Détail : en-tête du script.

---

## Modèle B — base staging/temp désignée

### Prérequis
- Client `psql` + `gzip` disponibles.
- Une base PostgreSQL **dédiée au drill**, dont le nom contient un **marqueur sûr** :
  `restore`, `drill`, `staging` ou `temp` (ex. `blob_restore_drill`).
- Un dump `.sql.gz` (format produit par [`backup-pg.sh`](../../scripts/backup-pg.sh)).

### Variables d'environnement

| Variable | Requis | Rôle |
|----------|--------|------|
| `RESTORE_TARGET_DATABASE_URL` | **oui** | Cible du restore. **Jamais** la prod. Le nom de DB doit contenir un marqueur sûr. |
| `DATABASE_URL` | non | Si défini, le script **refuse** toute cible identique (chaîne ou tuple host:port/db). |
| `ALLOW_RESTORE_DRILL` | non | Doit valoir `true` pour autoriser le drill quand `NODE_ENV=production`. |
| `RESTORE_FORBIDDEN_HOSTS` | non | Hôtes interdits supplémentaires (séparés par virgule). |
| `RESTORE_MIN_BYTES` | non (1024) | Taille minimale du dump (anti dump vide). |
| `RESTORE_MIN_TABLES` | non (5) | Nombre minimal de tables attendu à la vérification. |

### 1. Dry-run (aucune connexion, aucune écriture)

```bash
RESTORE_TARGET_DATABASE_URL='postgresql://drilluser:***@staging-db:5432/blob_restore_drill' \
  ./scripts/restore-postgres-drill.sh /chemin/blobconnect_prevps_<...>.sql.gz --dry-run
```

Le dry-run exécute **tous** les garde-fous anti-prod et valide le dump
(existence, taille, extension, intégrité gzip) sans jamais se connecter.

### 2. Restore vers la base temporaire + vérification

```bash
RESTORE_TARGET_DATABASE_URL='postgresql://drilluser:***@staging-db:5432/blob_restore_drill' \
  ./scripts/restore-postgres-drill.sh /chemin/blobconnect_prevps_<...>.sql.gz --verify
```

### 3. Vérification seule (base déjà restaurée)

```bash
RESTORE_TARGET_DATABASE_URL='postgresql://drilluser:***@staging-db:5432/blob_restore_drill' \
  ./scripts/restore-postgres-drill.sh --verify
```

La vérification est **read-only** (`COUNT`, `information_schema`, présence de
`_prisma_migrations`) : aucune ligne utilisateur, aucun `SELECT *`, aucun secret en log.

### Garde-fous anti-prod (le script refuse de tourner si)
- `RESTORE_TARGET_DATABASE_URL` absent/vide ;
- cible identique à `DATABASE_URL` (chaîne **ou** tuple host:port/db) ;
- `NODE_ENV=production` sans `ALLOW_RESTORE_DRILL=true` ;
- host ou nom de DB cible contient `prod`/`production`, ou figure dans `RESTORE_FORBIDDEN_HOSTS` ;
- le nom de DB cible ne contient **pas** de marqueur sûr (`restore|drill|staging|temp`).

> Le script privilégie un faux négatif (refus) à une restauration destructive.

---

## Procédure de drill complète (8 étapes)

1. Sur le VPS, lister les backups : `ls -lh "$BACKUP_DIR"/*.sql.gz`.
2. Choisir le dump le plus récent ; noter sa taille (≠ 0).
3. **Dry-run** (modèle A ou B) → doit afficher *intégrité OK* et passer les garde-fous.
4. Préparer la cible : créer/vider une base `*_restore_drill` (modèle B) — jamais la prod.
5. **Restore** vers la cible temporaire avec `--verify`.
6. Contrôler le verdict : tables ≥ seuil, `_prisma_migrations` présent, dernière migration cohérente.
7. (Optionnel) lancer un smoke applicatif pointé sur la base restaurée.
8. **Nettoyer** : supprimer la base temporaire / le conteneur éphémère.

## En cas d'échec

| Symptôme | Sens | Action |
|----------|------|--------|
| gzip corrompu | fichier illisible | backup inutilisable → investiguer le run de backup, en relancer un |
| dump vide / < seuil tables | dump incomplet | vérifier que la DB source contenait des données au moment du dump |
| erreurs non-ignorables | incompatibilité schéma | comparer versions PostgreSQL/extensions, migrations |
| `_prisma_migrations` absente | schéma non géré par Prisma | vérifier que le dump provient bien de la prod |
| refus « marqueur sûr » / « prod » | mauvaise cible | corriger `RESTORE_TARGET_DATABASE_URL` (jamais la prod) |

## Rollback

Le drill n'écrit **que** sur la base temporaire : le rollback consiste à
**supprimer** cette base (`DROP DATABASE`/`dropdb`) ou détruire le conteneur éphémère.
La production n'est jamais modifiée — il n'y a rien à annuler côté prod.

## Fréquence recommandée

- **Avant la première mise en prod** : 1 restore drill complet.
- **Avant tout gros changement de schéma** (migration importante) : 1 restore drill.
- **Ensuite** : mensuel au début, puis trimestriel si stable.
- Après toute alerte backup `CRITICAL` résolue : confirmer la reprise.

## Check-list mensuelle (copiable)

```text
[ ] Dernier backup présent et taille ≠ 0 (ls -lh "$BACKUP_DIR")
[ ] Dry-run OK (intégrité gzip + garde-fous)
[ ] Restore vers base *_restore_drill réussi
[ ] --verify : tables >= seuil, _prisma_migrations présent, dernière migration cohérente
[ ] Base temporaire supprimée après le drill
[ ] Aucun secret dans la sortie des commandes
```

## Garde-fous automatiques

- [`scripts/check-restore-scripts.sh`](../../scripts/check-restore-scripts.sh) :
  vérifie statiquement les garde-fous, l'absence d'`accept-data-loss`, l'absence de
  log de connection string (lancé en CI, sans DB).
- [`scripts/test-restore-drill-guards.sh`](../../scripts/test-restore-drill-guards.sh) :
  teste les refus (cible absente/prod/non-marquée, dump absent/vide/mauvaise extension,
  dry-run) sans aucune base de données.
