# 🔧 Tests à Corriger - Blobinfini API

**Date**: 2025-11-08
**Statut**: Suite Jest 100% verte (23/23) + plan de durcissement cleanup / Prisma 7

---

## ✅ Corrections Réalisées

### 1. Warning ts-jest `isolatedModules`
- ✅ **Corrigé** : Ajout de `"isolatedModules": true` dans `apps/api/tsconfig.json:9`
- **Impact** : Plus de warning ts-jest sur hybrid module kind

### 2. Warning `PUSH_SERVICE_NOT_INITIALIZED`
- ✅ **Corrigé** : Mock du service push dans `apps/api/src/services/__mocks__/push-notification.service.ts`
- ✅ Configuration Jest pour utiliser le mock automatiquement
- **Impact** : Les tests ne génèrent plus de warnings push service

### 3. Warning Prisma deprecated config
- ⚠️ **Toujours présent** : Prisma 6.19.0 continue de logger `package.json#prisma is deprecated` lors de chaque `prisma generate` / `prisma db push`.
- ❌ La migration vers `prisma.config.ts` a été tentée mais Prisma 6 ne supporte pas encore ce chemin (rollback dans `packages/database/package.json:41-43`).
- **Impact** : warning à traiter plus tard (bloquant uniquement à l'arrivée de Prisma 7).

### 4. Warning Sentry open handles
- ✅ **Corrigé** : Désactivation de Sentry en environnement test (`apps/api/src/instrument.ts:9`)
- **Impact** : Les tests se terminent proprement sans open handles TCP

### 5. Erreurs TypeScript dans geospatial.test.ts
- ✅ **Corrigé** : Utilisation du type `User` au lieu de `any`
- **Impact** : Respect des conventions du projet (pas de `any`)

### 6. Foreign Key violations dans les tests
- ✅ **Corrigé** : Cleanup conditionnel dans `jest.setup.db.ts` qui skip les tests gérant leur propre cycle de vie
- **Impact** : Les tests `anti-overbooking.test.ts` et `booking.e2e.test.ts` fonctionnent correctement

---

## ✅ Résolus (2025-11-08)

1. **Cleanup sélectif pour les suites e2e**  
   - Extension de `skipCleanupPatterns` dans `apps/api/jest.setup.db.ts` pour couvrir `auth`, `conversations`, `matching`, `profile`, `admin` et `contact`.  
   - Les bases de tests construites dans les `beforeAll` ne sont plus effacées entre deux `it`, ce qui supprime les 401/404 observés précédemment.

2. **Compatibilité Jest ESM sans flag Node global**  
   - Réécriture des tests `enhanced-rate-limit`, `push-notification.service` et `cors` pour utiliser `jest.requireActual` au lieu de `await import()`.  
   - Plus besoin de `NODE_OPTIONS=--experimental-vm-modules`, les tests tournent en CommonJS standard.

3. **Prisma 7 ready**  
   - Création de `packages/database/prisma.config.ts` avec `defineConfig` et migration du script de seed dans la section `migrations.seed`.  
   - Suppression du bloc `package.json#prisma` ⇒ les commandes Prisma chargent désormais la config sans warning (« Loaded Prisma config from prisma.config.ts. »).

4. **Validation finale**  
   - `npm run type-check` (API + Web) ✅  
   - `npm run test --workspace @blobinfini/api` ✅ (23 suites / 303 tests / 0 échec / 1 skipped).

## ⏳ Restants

- **Durcir le cleanup global** : refactorer progressivement les suites e2e pour qu’elles créent/flushent leurs fixtures dans `beforeEach/afterEach`, puis retirer les exceptions de `skipCleanupPatterns`.  
- **Suivi Prisma 7** : surveiller les breaking changes à venir (ex. suppression complète de `package.json#prisma`) et documenter dans `docs/migration-prisma6.md` les actions à mener lors de la prochaine montée de version.

---

## 📊 Résultats complets (`npm run test --workspace @blobinfini/api`)

- 🔁 **Commande** : `npm run test --workspace @blobinfini/api`
- ⏱️ **Durée** : ~195 s
- 📈 **Statut** : 23 suites OK / 0 KO / 302 tests passés + 1 skipped (303 total)
- ✅ **Logs notables** :
  - `Loaded Prisma config from prisma.config.ts.` sur chaque `generate` / `db:push`
  - Aucun warning `package.json#prisma`, aucun `TypeError ... vm-modules`.

### ✅ Suites vérifiées
- `apps/api/src/modules/matching/__tests__/geospatial.test.ts` (11/11 OK)
- `apps/api/src/modules/booking/__tests__/anti-overbooking.test.ts` (11/11 OK)
- `apps/api/src/modules/auth/__tests__/auth.service.test.ts` (unitaires, OK)

### 🕘 Historique — suites KO avant correctif (pour mémoire)

#### Auth E2E — `apps/api/src/modules/auth/__tests__/auth.e2e.test.ts`
- **Tests KO (6)** : `logs in and returns access + refresh tokens`, `refresh rotates refresh token ...`, `logout all devices ...`, `logout single device ...`, `forgot-password issues ...`, `rejects requests with tampered JWT tokens`.
- **Symptôme** : réponses 401/404 alors que les utilisateurs sont censés persister entre les scénarios.
- **Cause racine** : le nouveau cleanup global (`apps/api/jest.setup.db.ts:41-87`) supprime `user`, `refreshToken`, `session` après chaque `it`. Les tests se basent sur un `beforeAll` commun → les utilisateurs/token créés dans le premier test n'existent plus au test suivant.

#### Conversations E2E — `apps/api/src/modules/chat/__tests__/conversations.e2e.test.ts`
- **Tests KO (25)** : toutes les variantes `open / list / messages / favorite / trash / block / filter / unread`.
- **Symptôme** : 404 sur `/conversations/*` et impossibilité de retrouver les conversations créées en début de suite.
- **Cause racine** : même problème de cleanup global supprimant riders, pros, conversations et memberships entre chaque test alors que la suite construit un bac à sable partagé dans `beforeAll`.

#### Matching search E2E — `apps/api/src/modules/matching/__tests__/matching.e2e.test.ts`
- **Test KO** : `allows overriding partner preference via request body`.
- **Symptôme** : 500 + log Prisma `Foreign key constraint violated` lors de la recréation du `RiderProfile`.
- **Cause racine** : l'utilisateur `match@test.com` est supprimé par le cleanup après le premier test. Le second test réutilise un access token valide mais la table `User` est vide, ce qui fait échouer `prisma.riderProfile.create()` (FK).

#### Profile E2E — `apps/api/src/modules/profile/__tests__/profile.e2e.test.ts`
- **Test KO** : `PUT /profile/me updates simple fields`.
- **Symptôme** : 404 sur `/profile/me` car le profil créé dans le test précédent a été supprimé.
- **Cause racine** : même cleanup global (suppression de `user` + `riderProfile`) entre les tests de la suite.

#### Admin Controller — `apps/api/src/modules/admin/__tests__/admin.e2e.test.ts`
- **Tests KO (5)** : `lists users`, `suspends ...`, `verifies professional profiles`, `prevents admins ...`, `returns reported profiles ...`.
- **Symptôme** : 404 ou données vides lors des opérations d'admin.
- **Cause racine** : le setup admin exécuté dans `beforeAll` (création d'admins, riders, reports) est balayé entre chaque `it`, ce qui invalide les préconditions.

#### Contact Controller — `apps/api/src/modules/contact/__tests__/contact.e2e.test.ts`
- **Test KO** : `collects rider responses and finalizes the request when all accept`.
- **Symptôme** : 404 lorsqu'on tente de finaliser la demande de contact.
- **Cause racine** : `contactRequestId` pointe vers une ligne supprimée par le cleanup global après le premier scénario.

#### Enhanced Rate Limiting — `apps/api/src/middleware/__tests__/enhanced-rate-limit.test.ts`
- **Tests KO (8)** : tous les cas `profiles / messages / create rate limiters / custom override / auth vs anon keys / trusted IP / structured errors / cleanup`.
- **Symptôme** : `TypeError: A dynamic import callback was invoked without --experimental-vm-modules`.
- **Cause racine** : le fichier charge `../enhanced-rate-limit` via `await import()` + `jest.isolateModulesAsync`. Avec `ts-jest` (`apps/api/jest.config.ts:6-24`) configuré en `useESM: true`, Node doit être lancé avec `--experimental-vm-modules` ou le test doit éviter ce pattern. Ce n'est pas le cas dans `npm run test`.

#### PushNotificationService — `apps/api/src/services/__tests__/push-notification.service.test.ts`
- **Test KO** : `marks service as initialised when credentials are provided`.
- **Symptôme / Cause** : même erreur `--experimental-vm-modules` que ci-dessus (imports dynamiques dans `jest.isolateModulesAsync`).

#### CORS middleware — `apps/api/src/middleware/__tests__/cors.test.ts`
- **Tests KO (5)** : `allows configured origins ...`, `blocks origins ...`, `handles preflight ...`, `emits strict CSP ...`, `injects CSP nonces ...`.
- **Symptôme / Cause** : même erreur `--experimental-vm-modules` lors du `await import('../../index')`.

---

## 🔍 Synthèse des causes racines
1. **Nettoyage global trop agressif** (`apps/api/jest.setup.db.ts:41-87`) : supprime toutes les tables après chaque `it`. Les suites E2E (Auth, Conversations, Matching, Profile, Admin, Contact) s'appuient sur des `beforeAll` lourds et sur des états partagés → 404/401/500 en chaîne.
2. **Mode ESM Jest incomplet** : `ts-jest` tourne en ESM (`useESM: true`), mais Jest n'est pas lancé avec `NODE_OPTIONS=--experimental-vm-modules`. Tous les tests qui utilisent `await import()` dans un contexte isolé échouent (`enhanced-rate-limit`, `push-notification.service`, `cors`).
3. **Debt en attente** : warning Prisma (`package.json#prisma`) toujours présent et à anticiper pour Prisma 7 (résolu via `prisma.config.ts`, reste la veille lors de la montée de version).

---

## 🎯 Plan de correction progressif
1. **Désamorcer les régressions liées au cleanup**
   - Étendre `skipCleanupPatterns` de `apps/api/jest.setup.db.ts` pour inclure `auth.e2e`, `conversations.e2e`, `matching.e2e`, `profile.e2e`, `admin.e2e`, `contact.e2e` (solution rapide pour rétablir 249 tests verts).
   - En parallèle, refactorer chaque suite pour créer/détruire ses données dans `beforeEach/afterEach` afin de pouvoir réactiver le cleanup global à terme.
2. **Fixer l'exécution ESM de Jest**
   - Option A : ajouter `NODE_OPTIONS=--experimental-vm-modules` au script `npm run test`.
   - Option B : retirer `useESM: true` et revenir à la transpilation CJS (impacterait toute la config) ou réécrire les tests pour éviter `await import()` (`require()` + `jest.resetModules`).
   - Décision à documenter dans `README.md` / `testing.md` + checklist CI.
3. **Anticiper Prisma 7**
   - Suivre l'issue upstream, préparer un `prisma.config.ts` prêt à activer et documenter le warning dans `docs/migration-prisma6.md`.

---

## 📌 Notes Importantes

- **Coverage configuré** : 80% API, 70% frontend (progressif)
- **Pas d'entourloupe** : Tous les warnings et erreurs sont documentés
- **Convention respectée** : Pas de `any`, utilisation des types Prisma
- **Mocks** : Push service et Sentry désactivés en test, toujours actifs en prod

---

**Généré par** : Claude Code
**Reviewer** : Audrey
