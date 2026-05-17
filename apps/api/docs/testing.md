# Testing Guide - BlobInfini API

## Architecture de tests Jest

### Global Setup (DB Schema) - P1 Optimisé

**Fichier**: `apps/api/jest.global-setup.cjs`

Le schéma DB est préparé **UNE SEULE FOIS** par run Jest au lieu d'avant chaque suite de tests.

**Étapes du Global Setup:**

1. **[1/4] Generate Prisma Client** (`npm run generate`)
2. **[2/4] Prepare schema DB**
   - **Si `JEST_DB_PREPARED=true`**: aucune préparation de schéma, la DB a déjà été migrée
   - **Sinon**: `npm run migrate:deploy` (sans `ALLOW_ACCEPT_DATA_LOSS`)
3. **[3/4] Verify Postgres connection** (query test)
4. **[4/4] Seed minimal test users** (2 users: admin + rider)

**Gardes de sécurité:**
- ✅ Le setup Jest n'appelle jamais `db push`
- ✅ Le setup Jest supprime `ALLOW_ACCEPT_DATA_LOSS` avant toute préparation DB
- ✅ CI prépare la DB avec `db:migrate:deploy`, puis lance Jest avec `JEST_DB_PREPARED=true`
- ❌ BLOCKED si `APP_ENV=production` ou `CI_PROD=true`

**Performance:**
- Avant P1: ~75s (generate + préparation DB × 3 suites)
- Après P1: ~7s (generate + préparation DB globale × 1) → **10x plus rapide**

---

### Test Isolation (Reset DB)

**Fichier**: `apps/api/src/test-utils/resetDb.ts`

Chaque test bénéficie d'une DB propre via `resetDb()` exécuté dans `afterEach`.

**Stratégie:**
- `deleteMany` avec ordre FK-safe (enfants → parents)
- Préserve les 2 users de seed (`dev+admin@test.com`, `dev+rider@test.com`)
- Liste blanche stricte des tables métier

**Configuration:**
```bash
# Désactiver le reset (debug uniquement)
TEST_DB_RESET=false pnpm test

# Afficher les logs de reset détaillés
TEST_DB_RESET_DEBUG=true pnpm test
```

**Tables nettoyées (ordre):**
```
message → conversationMember → conversation
→ matchDecision → match → booking → bookingRequest
→ proAvailability → lastSearch → riderDiscipline
→ proOffer → profileReport → passwordResetToken
→ emailVerificationToken → session → refreshToken
→ adminProfile → riderProfile → proProfile
→ user (sauf seeds)
```

---

## Commandes de test

### Tests rapides (sans coverage)

```bash
# Tous les tests
pnpm test --runInBand --no-coverage

# Tests WebSocket P0 uniquement
pnpm test socket-connection-limits socket-reconnection-storm socket-auth-hardening --runInBand --no-coverage
```

### Tests avec coverage

```bash
# Tous les tests + coverage
pnpm test --runInBand

# Tests spécifiques + coverage
pnpm test socket-* --runInBand
```

### Debug mode

```bash
# Désactiver reset DB (garder les données entre tests)
TEST_DB_RESET=false pnpm test socket-auth-hardening

# Logs détaillés du reset
TEST_DB_RESET_DEBUG=true pnpm test
```

---

## Fichiers de configuration Jest

| Fichier | Rôle |
|---------|------|
| `jest.config.cjs` | Config Jest principale + globalSetup |
| `jest.global-setup.cjs` | Setup DB global (1 fois par run) |
| `jest.setup.env.ts` | Variables d'environnement |
| `jest.setup.secrets.ts` | Secrets de test |
| `jest.setup.db.ts` | Isolation tests (resetDb afterEach) |
| `jest.setup.redis.ts` | Setup Redis (mocks) |
| `jest.setup.ts` | Setup général |

---

## Sécurité - DB Push Guard

**Porte unique**: `packages/database/scripts/safe-db-push.mjs`

**Règles de sécurité (toutes obligatoires):**

1. ✅ `ALLOW_ACCEPT_DATA_LOSS=true` (unlock explicite)
2. ✅ Contexte test vérifié (`NODE_ENV=test` OR `CI_TEST_DB=true`)
3. ❌ HARD DENY si `APP_ENV=production` OR `CI_PROD=true`

**IMPORTANT**:
- Ne JAMAIS modifier `safe-db-push.mjs` pour contourner les gardes
- En production, utiliser `prisma migrate deploy` uniquement
- `db push --accept-data-loss` est INTERDIT hors contexte test

---

## Watch Mode

**Comportement**: Le `globalSetup` s'exécute à chaque lancement de Jest en watch mode.

**Optimisation**:
- Prisma generate est rapide si rien n'a changé (~500ms)
- `migrate:deploy` est no-op si les migrations sont déjà appliquées

**Note**: Pas d'optimisation watch mode P0 (acceptable pour dev local).

---

## Seeds de test

**Users créés automatiquement (Global Setup):**

```typescript
// Admin de test
{
  email: 'dev+admin@test.com',
  role: 'ADMIN',
  emailVerified: true
}

// Rider de test
{
  email: 'dev+rider@test.com',
  role: 'RIDER',
  emailVerified: true
}
```

**Accès**: Ces users sont disponibles dans tous les tests et préservés par `resetDb()`.

---

## Troubleshooting

### Tests échouent avec "User not found"

**Cause**: Seeds pas créés ou DB pas synchro.

**Solution**:
```bash
# Vérifier les seeds
TEST_DB_RESET_DEBUG=true pnpm test socket-connection-limits
# → Devrait afficher "Seed complete (2 test users)"
```

### "Multiple DB setup detected"

**Cause**: Global Setup pas activé.

**Solution**: Vérifier `jest.config.cjs` contient:
```javascript
globalSetup: '<rootDir>/jest.global-setup.cjs',
```

### Tests lents (>60s)

**Cause**: `generate` + préparation DB exécutés plusieurs fois.

**Solution**: Vérifier logs au démarrage:
```
🔧 [Global Setup] Starting Jest DB preparation...
```
→ Doit apparaître UNE seule fois.

### Open handles après tests

**Cause**: Connexions Prisma ou Redis pas fermées.

**Solution**: Vérifier que les tests appellent:
```typescript
afterAll(async () => {
  await prisma.$disconnect();
  await redisClient.disconnect();
});
```

---

## Métriques de performance

| Métrique | Avant P1 | Après P1 | Gain |
|----------|----------|----------|------|
| Setup DB | 3× (par suite) | 1× (global) | -66% |
| Temps total | ~75s | ~7.6s | **10x** |
| DB setup calls | 3 | 1 | -66% |
| generate calls | 3 | 1 | -66% |

---

## Références

- **Global Setup**: `apps/api/jest.global-setup.cjs`
- **Reset DB**: `apps/api/src/test-utils/resetDb.ts`
- **Setup DB**: `apps/api/jest.setup.db.ts`
- **Safe DB Push**: `packages/database/scripts/safe-db-push.mjs`
- **Tests WebSocket P0**:
  - `src/lib/__tests__/socket-connection-limits.test.ts`
  - `src/lib/__tests__/socket-reconnection-storm.test.ts`
  - `src/lib/__tests__/socket-auth-hardening.test.ts`
