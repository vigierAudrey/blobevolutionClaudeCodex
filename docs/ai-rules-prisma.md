# Règles Prisma — Bloc pour prompts IA

**Usage :** intégrer ce bloc dans les prompts système de tout agent IA (Claude Code,
Cursor, Copilot, etc.) qui peut proposer des modifications de schéma DB sur ce projet.

---

## BLOC RÈGLES PRISMA (à copier dans les prompts système)

```
## RÈGLES PRISMA — OBLIGATOIRES

### 1. Toute modification de schéma passe par `prisma migrate dev`

Tu NE DOIS PAS proposer ou exécuter :
- `prisma db push` (interdit hors test local isolé, même avec --skip-generate)
- `prisma db push --accept-data-loss` (interdit en toutes circonstances hors test)
- `psql -c "ALTER TABLE..."` ou tout DDL SQL direct pour modifier le schéma
- Modification de `schema.prisma` sans créer une migration correspondante

Tu DOIS toujours :
- Modifier `packages/database/prisma/schema.prisma`
- Exécuter `pnpm --filter @blobinfini/database migrate` pour générer la migration
- Committer le fichier `migration.sql` généré avec le fichier schema.prisma

### 2. Migrations non rejouables sur DB vide = BLOQUÉ CI

Tout SQL dans une migration doit fonctionner sur une DB vide.
Si tu crées une migration qui référence un objet existant (table, colonne, type),
tu dois utiliser `IF NOT EXISTS` ou vérifier que l'objet est créé dans une migration
précédente dans la même chaîne.

### 3. Stubs SELECT 1 = justification obligatoire

Si une migration doit être un no-op (SELECT 1), elle doit contenir un commentaire
expliquant POURQUOI :
  -- Stub no-op: <raison>

Sans justification, la CI bloque. Ne crée jamais un stub silencieux.

### 4. DDL destructif = approbation explicite

Si tu dois proposer une migration avec :
- DROP TABLE
- DROP COLUMN
- DROP TYPE
- TRUNCATE TABLE

Tu dois ajouter en première ligne du fichier migration.sql :
  -- DANGEROUS-DDL-APPROVED: <raison précise>

Sans ce marqueur, la CI bloque la PR.

### 5. Quand une migration échoue en local

Tu NE DOIS PAS proposer :
- `prisma db push` pour contourner
- `psql -c` pour appliquer le DDL manuellement
- `prisma migrate resolve --rolled-back` sans analyse de cause

Tu DOIS :
- Identifier la cause (objet déjà présent, objet manquant, contrainte violée)
- Corriger le SQL de la migration (ajouter IF NOT EXISTS si applicable)
- Proposer `prisma migrate resolve --applied` uniquement si l'objet existe déjà
  en DB et que le SQL est factuellement correct
- Toujours référencer le runbook : docs/runbooks/migration-failed.md

### 6. Preuve fresh DB obligatoire

Après toute migration proposée, tu dois être en mesure de confirmer :
- La migration peut être rejouée depuis une DB vide (pas d'objet pré-existant supposé)
- Le schéma final après migration correspond exactement à schema.prisma
- `prisma migrate status` retournerait "Database schema is up to date!"

### 7. Checksum Prisma

Ne modifie JAMAIS le contenu d'un fichier `migration.sql` déjà committed et
appliqué sur au moins une instance (prod, staging, CI). Prisma stocke des checksums
dans `_prisma_migrations`. Une modification change le checksum → `migrate deploy`
échoue sur toutes les instances ayant déjà appliqué cette migration.
```

---

## Pourquoi ces règles existent

**Incident 2026-03 (résolu 2026-04-03) :**
Usage de `prisma db push` a créé une colonne en local. La migration générée ensuite
a échoué (`column already exists`). Pour débloquer l'API, 13 migrations ont été
appliquées hors `_prisma_migrations` (SQL direct / db push). La chaîne de migration
était corrompue et non-déployable en production.

**Conséquence :** `prisma migrate deploy` bloqué. Résolution : `migrate resolve --applied`
sur 14 migrations, reconstruction du runbook, activation du job CI bloquant.

**Temps de résolution :** plusieurs heures.  
**Risque production :** élevé (déploiement impossible sans intervention manuelle).

---

## Commandes autorisées vs interdites

| Action | Commande autorisée | Interdit |
|--------|--------------------|---------|
| Modifier le schéma | `pnpm --filter @blobinfini/database migrate` | `prisma db push` |
| Appliquer en prod | `pnpm run db:migrate:deploy` | `prisma db push`, SQL direct |
| Test local (reset) | `pnpm --filter @blobinfini/database migrate:test:clean` | `prisma db push --accept-data-loss` |
| Vérifier l'état | `prisma migrate status` | Comparer manuellement `_prisma_migrations` |
| Débloquer FAILED | `prisma migrate resolve --applied <name>` | Supprimer la ligne de `_prisma_migrations` |
