# Runbook — Migration Failed (opérationnel)

**Quand utiliser ce runbook :**  
`prisma migrate status` affiche une migration en état `FAILED` (finished_at = NULL),
ou `prisma migrate deploy` se bloque avec une erreur DDL.

---

## 1. Identification immédiate

```bash
# Vérifier l'état exact
pnpm --filter @blobinfini/database exec prisma migrate status
```

Identifier :
- Le nom exact de la migration en FAILED
- Le message d'erreur SQL (`ERROR: column "x" already exists`, `relation "y" does not exist`, etc.)
- Si des migrations **suivantes** ont été appliquées malgré le FAILED

---

## 2. Diagnostic — 3 cas possibles

### Cas A : objet déjà présent (`column "x" already exists`, `relation "y" already exists`)

**Cause :** `db push` ou SQL direct a créé l'objet avant la migration.

**Fix :**
```bash
# 1. Backup obligatoire avant toute intervention
docker exec <container> pg_dump -U postgres <dbname> > backup_$(date +%Y%m%d_%H%M%S).sql

# 2. Corriger le SQL de la migration pour ajouter IF NOT EXISTS
#    MODIFIER le fichier migration.sql UNIQUEMENT si la migration n'a pas encore
#    été appliquée sur d'autres instances (prod, staging, CI).
#    Si déjà appliquée ailleurs → utiliser l'option resolve ci-dessous.

# Option resolve (si l'objet existe et que le SQL est correct hors conflit) :
pnpm --filter @blobinfini/database exec prisma migrate resolve --applied <migration_name>

# 3. Vérifier
pnpm --filter @blobinfini/database exec prisma migrate status
```

### Cas B : objet manquant (`relation "x" does not exist`, `column "y" does not exist`)

**Cause :** migration référence un objet qui n'existe pas encore à ce point dans la chaîne.

**Fix :**
```bash
# 1. Backup
docker exec <container> pg_dump -U postgres <dbname> > backup_$(date +%Y%m%d_%H%M%S).sql

# 2. Corriger l'ordre des migrations (renommer si nécessaire pour changer le timestamp)
#    OU ajouter un IF EXISTS dans la migration défaillante.
#    ATTENTION : modifier le nom d'une migration change son checksum Prisma.

# 3. Ne JAMAIS créer l'objet manquant via psql direct ou db push.
#    Créer une nouvelle migration correctrice si l'objet doit exister séparément.
```

### Cas C : erreur de contrainte ou de type (`violates constraint`, `cannot cast type`)

**Cause :** migration tente une opération incompatible avec les données existantes.

**Fix :**
```bash
# 1. Backup
docker exec <container> pg_dump -U postgres <dbname> > backup_$(date +%Y%m%d_%H%M%S).sql

# 2. Créer une nouvelle migration de backfill AVANT la migration problématique
#    pour nettoyer les données incompatibles.
#    Exemple : mettre à NULL les valeurs orphelines avant d'ajouter une FK.

# 3. Ne pas modifier le contenu d'une migration déjà appliquée sur prod/staging.
```

---

## 3. Règle absolue de priorisation

```
1. Backup
2. Identifier la cause (psql direct en lecture seule OK pour diagnostic)
3. Corriger le SQL de migration OU utiliser resolve --applied
4. Rejouer via prisma migrate deploy
5. Vérifier avec prisma migrate status
```

---

## 4. CE QU'IL NE FAUT JAMAIS FAIRE

| Interdit | Raison |
|----------|--------|
| `prisma db push` pour débloquer | Crée un drift local invisible. C'est l'origine de l'incident 2026-03. |
| `psql -c "ALTER TABLE..."` direct | Applique du DDL hors `_prisma_migrations` → LOCAL_ONLY |
| Modifier une migration déjà appliquée sur prod | Change le checksum → `migrate deploy` refusera sur les autres instances |
| Supprimer la ligne de `_prisma_migrations` | La migration sera rejouée → doublons d'objets, erreurs garanties |
| `resolve --rolled-back` sur une migration partiellement appliquée | Laisse des objets orphelins en DB |
| Contourner via `--skip-generate` | Sans generate, les types TS ne sont pas à jour → erreurs runtime |

---

## 5. Escalade

Si aucun des 3 cas ne s'applique, ou si la chaîne est corrompue de manière non triviale :

1. Ouvrir un incident → `docs/runbooks/prisma-migration-drift-2026-03.md` pour le précédent
2. Ne pas intervenir sur la DB de production sans backup vérifié (restore testé)
3. Utiliser une DB de staging pour valider la séquence de résolution avant prod

---

## 6. Preuve de résolution

Après toute intervention :

```bash
# État attendu : "Database schema is up to date!"
pnpm --filter @blobinfini/database exec prisma migrate status

# Preuve fresh DB : rejouer depuis zéro sur une DB de test
DATABASE_URL="postgresql://.../<test_db>" \
  pnpm --filter @blobinfini/database exec prisma migrate deploy
# Attendu : toutes les migrations appliquées, aucune erreur.
```
