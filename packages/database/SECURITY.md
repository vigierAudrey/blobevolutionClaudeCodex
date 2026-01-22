# Database Security - Prisma Guards

**Priority**: P0 (Critical)

## Règle d'or

🚨 **JAMAIS `prisma db push --accept-data-loss` en production.**

Ce flag peut **irréversiblement détruire** tables, colonnes et données sans migration ni rollback possible.

---

## Variables requises (double clé)

Pour autoriser `db push` en **test uniquement** :

1. **ALLOW_ACCEPT_DATA_LOSS=true** (unlock explicite)
2. **Contexte test** (un de) :
   - `NODE_ENV=test`
   - `APP_ENV=test`
   - `CI_TEST=true`

**WHITELIST strict** : Tout autre environnement (staging, dev, prod, vide) est **REFUSÉ par défaut**.

---

## Exemples

### ✅ AUTORISÉ (test local)

```bash
ALLOW_ACCEPT_DATA_LOSS=true NODE_ENV=test npm run db:push --workspace @blobinfini/database
```

**Exit code** : 0
**Sortie attendue** : `✅ AUTHORIZATION GRANTED`

### ❌ INTERDIT (production)

```bash
ALLOW_ACCEPT_DATA_LOSS=true NODE_ENV=production npm run db:push --workspace @blobinfini/database
```

**Exit code** : 1
**Sortie** : `❌ BLOCKED: Production environment detected.`

### ❌ INTERDIT (flag manquant)

```bash
NODE_ENV=test npm run db:push --workspace @blobinfini/database
```

**Exit code** : 1
**Sortie** : `❌ BLOCKED: Missing required authorization flag.`

### ❌ INTERDIT (staging, deny-by-default)

```bash
ALLOW_ACCEPT_DATA_LOSS=true APP_ENV=staging npm run db:push --workspace @blobinfini/database
```

**Exit code** : 1
**Sortie** : `❌ BLOCKED: Not running in explicit test context.`

---

## Où vivent les guards

### Guard #1 : Runtime wrapper

**Fichier** : `packages/database/scripts/safe-db-push.mjs`
**Package.json** : `"db:push": "node scripts/safe-db-push.mjs"`
**Tests** : `packages/database/scripts/__tests__/safe-db-push.test.mjs`

**Logique** :
1. Hard deny si `APP_ENV=production` ou `CI_PROD=true`
2. Require `ALLOW_ACCEPT_DATA_LOSS=true`
3. Require contexte test explicite (whitelist)

### Guard #2 : Jest setup

**Fichier** : `apps/api/jest.setup.db.ts` (lignes 15-36)
**Timing** : Exécuté **avant** `execSync` dans `beforeAll()`

**Protection** : Double vérification défensive avant appel au wrapper.

### Guard #3 : CI static check

**Fichier** : `scripts/check-accept-data-loss.mjs`
**Commande** : `npm run guard:accept-data-loss`
**Exécution** : Locale + CI

**Logique** :
- Scan `git grep --accept-data-loss`
- Whitelist : wrapper + docs uniquement
- Toute occurrence hors whitelist → exit 1

---

## Diagnostic rapide

### Pourquoi ça bloque ?

| Message d'erreur | Cause | Solution |
|------------------|-------|----------|
| `Production environment detected` | `APP_ENV=production` ou `CI_PROD=true` | **Ne jamais** utiliser en prod. Utiliser `prisma migrate deploy` |
| `Missing required authorization flag` | `ALLOW_ACCEPT_DATA_LOSS` absent ou != "true" | Ajouter `ALLOW_ACCEPT_DATA_LOSS=true` (test uniquement) |
| `Not running in explicit test context` | Aucun flag test valide détecté | Définir `NODE_ENV=test` ou `APP_ENV=test` ou `CI_TEST=true` |

### Commande de vérification

```bash
# Vérifier qu'aucun chemin non protégé n'existe
npm run guard:accept-data-loss

# Lancer les tests de preuve
node packages/database/scripts/__tests__/safe-db-push.test.mjs
```

---

## Production

**Jamais `db:push`**. Toujours utiliser les migrations :

```bash
# Génération migration
npm run db:migrate --workspace @blobinfini/database

# Déploiement production
npm run db:migrate:deploy --workspace @blobinfini/database
```

---

## Architecture (résumé)

```
User → npm run db:push (package.json)
         ↓
       safe-db-push.mjs (Guard #1)
         ├─ Check APP_ENV != production
         ├─ Check CI_PROD != true
         ├─ Check ALLOW_ACCEPT_DATA_LOSS == true
         ├─ Check test context (whitelist)
         ↓
       prisma db push --accept-data-loss

CI → npm run guard:accept-data-loss (Guard #3)
       ├─ Scan git grep
       ├─ Verify whitelist
       ↓
       exit 0 (pass) | exit 1 (violations)
```

**Messages neutres** : Aucune valeur d'env n'est affichée (seulement noms de variables).

---

## Références

- **Wrapper** : `packages/database/scripts/safe-db-push.mjs`
- **Tests** : `packages/database/scripts/__tests__/safe-db-push.test.mjs`
- **CI guard** : `scripts/check-accept-data-loss.mjs`
- **Jest guard** : `apps/api/jest.setup.db.ts:15-36`
