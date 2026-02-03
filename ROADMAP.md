# 🚀 Roadmap de Développement BlobConnect (Blobinfini interne)

---

## 🏷️ Naming produit (IMPORTANT)

- **BlobConnect** = nom **visible utilisateurs** (UI, emails, pages publiques, wording marketing).
- **Blobinfini** = nom **interne/tech** (repo, namespaces, packages) tant qu’aucune décision de renommage globale n’est actée.
- Ne pas “renommer en masse” (variables, packages, env, Sentry, Firebase, URLs) sans ticket/validation : risque casse SEO, config, observabilité, clés, routes.

---

## 🧭 Vision & Stratégie

- **Philosophie 100% Open Source & Gratuit :** Monitoring (Clever Cloud ou alternative) + dashboards libres, infrastructure low-cost, outils open source-first pour réinvestir dans les fonctionnalités.
- **Positionnement MVP Simplifié :**
  - ✅ **Auth complète** (register, login, 2FA, reset password)
  - ✅ **Matching géospatial** (PostGIS, cartes, swipe)
  - ✅ **Booking & Messaging** (demandes, chat temps réel)
  - ⏸️ **Pas de paiement** (mis en pause, focus publicité AdSense)
  - ⏸️ **Pas de gamification** (flocons d'avoine retirés du MVP)
- **Monétisation initiale :** Publicité AdSense uniquement
- **Lignes directrices :**
  - Réduire drastiquement les coûts fixes (hébergement, monitoring, analytics).
  - Prioriser la fiabilité (sécurité, tests) avant toute extension fonctionnelle.
  - Documenter chaque évolution critique (sécurité, API, UI, performance).

---

## 📊 Indicateurs (historiques / exemple)

_Note : valeurs indicatives, non garanties comme etat actuel._

- **Score Santé global (exemple historique) :** 9.0/10 ⬆️ (+0.5) – Stack 100% gratuite.
- **Tests :** 498 tests (17 fichiers) – Couverture ~75%.
- **Sécurité (exemple historique) :** 7.0/10 ⚠️ à renforcer (CORS, secrets, logs, validation).
- **Performance :** Optimisations majeures complétées ✅.
- **PWA :** Push notifications + Service Worker + Offline ✅.
- **Monitoring :** Logs backend (Clever Cloud ou alternative) + standards (0€) ✅.

---

## 🎯 Priorités Immédiates (Vue Synthétique)

**Note :** Le module Auth est maintenant ✅ **COMPLÉTÉ** avec 100% des fonctionnalités prévues (register, login, 2FA, reset, CSRF, rate limiting, tests).

1. **🔒 Sécurité Production-Ready (Phase 3 - exemple monitoring & audits)** - BLOCKER PROD
   Corriger CORS, secrets, logs sensibles, validation Zod, renforcer Helmet/SSL/trust proxy. Voir section « Sécurité & Conformité ».
2. **🧪 Tests & Qualité**
   Finaliser tests UI (composants de base + matching), nettoyer données Playwright, fiabiliser flux CSRF. Voir section « Tests & Qualité ».
3. **📢 Publicité / Monétisation initiale**
   Finaliser déploiement AdSense, bannière RGPD et analytics revenus. Voir section « Monétisation (Publicité) ».
4. **⚙️ Performance & DX rapides**
   Connection pooling, compression, CDN gratuit, automatisation déploiement. Voir sections « Performance & UX » et « Developer Experience ».
5. **📈 Observabilité & Analytics**
   Endpoint `/security/health`, audit logs, dashboard analytics open source. Voir sections « Sécurité & Conformité » et « Croissance & Analytics ».

---

## 🔒 Sécurité & Conformité

### État actuel (historique / exemple)

- **Score Sécurité (exemple historique) :** 7.0/10 | **Objectif (exemple) :** 9.5/10 avant production.
- **Protections existantes :**
  - [x] CSRF protection complète sur tous les endpoints mutants.
  - [x] Rate limiting Redis (Auth 5/15min, Registration 3/h, API 100/15min, Search 30/min, Upload 10/10min, Messaging 10/min).
  - [x] RGPD : purge automatique en 3 phases (7j → 2 ans → 10 ans).
  - [x] JWT avec rotation/invalidation des refresh tokens.
  - [x] Bcrypt coût 12 pour les mots de passe.
  - [x] Helmet.js basique.

### Vulnérabilités critiques — Phase 1 (exemple, estimation 2h)

- [x] **CORS wildcard (*)** `apps/api/src/index.ts`  
  ```typescript
  const allowedOriginsSet = new Set((process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean));

  const corsMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    res.setHeader('Vary', 'Origin');

    if (origin) {
      if (!allowedOriginsSet.has(origin)) {
        secureLogger.warn('CORS_ORIGIN_BLOCKED', { origin });
        return res.status(403).json({ error: 'Origin not allowed' });
      }
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    // ...
  };
  ```
  Impact : XSS cross-site, vol de tokens, CSRF bypass.  
  Tests : Supertest (`apps/api/src/middleware/__tests__/cors.test.ts`) + `curl -H "Origin"` autorisé/interdit.

- [x] **Secrets par défaut faibles** `apps/api/src/index.ts` + `apps/api/src/modules/auth/auth.service.ts`  
  ```typescript
  const MIN_SECRET_LENGTH = 64;
  const REQUIRED_SECRETS = ['SESSION_SECRET', 'JWT_SECRET', 'JWT_REFRESH_SECRET'] as const;

  function ensureStrongSecret(key: 'JWT_SECRET' | 'JWT_REFRESH_SECRET') {
    const value = process.env[key];
    if (!value || value.length < MIN_SECRET_LENGTH) {
      throw new Error(`${key} must be at least ${MIN_SECRET_LENGTH} characters long`);
    }
    return value;
  }
  ```
  Impact : Session hijacking, JWT forgery.  
  Tests : démarrage API avec secret court → crash + jest setup assure secrets >=64.

- [x] **Logs de tokens sensibles** `apps/api/src/services/push-notification.service.ts` + `apps/api/src/modules/push/push.controller.ts`  
  ```typescript
  import { secureLogger } from '../utils/secure-logger';

  secureLogger.info('PUSH_TOKEN_SAVE', { userId });
  secureLogger.error('PUSH_TOKEN_SAVE_FAILED', { userId, error: error?.message });
  ```
  Impact : reconstruction token, notification hijacking.  
  Tests : push service unit tests mis à jour + `secureLogger` redaction (regex Bearer/token/email).

- [x] **Validation d'entrée incomplète** (⚠️ Partiel : logging sécurisé uniquement)
  ```typescript
  // apps/api/src/middleware/validate.ts - ÉTAT ACTUEL
  import { secureLogger } from '../utils/secure-logger';

  export const validate = (schema: ZodTypeAny) =>
    (req: Request, res: Response, next: NextFunction) => {
      try {
        req.body = schema.parse(req.body);
        return next();
      } catch (error: any) {
        if (error?.name === 'ZodError') {
          secureLogger.error('VALIDATION_ERROR', {
            path: req.path,
            errorCount: error.errors?.length
          });
          return res.status(400).json({ error: 'Invalid input', details: error.errors });
        }
        secureLogger.error('UNKNOWN_VALIDATION_ERROR', {
          path: req.path,
          error: error?.message
        });
        return res.status(400).json({ error: 'Invalid input' });
      }
    };
  ```
  ✅ **Fait (2025-11-10)** : Remplacé `console.error` par `secureLogger` (ne log plus req.body/PII).
  ✅ **Tests** : 12 tests unitaires ajoutés (`__tests__/validate.test.ts`), 314/314 tests passent.
  ⚠️ **Reste à faire** : Étendre validation à `query` et `params` (actuellement seulement `body`).
  Impact : SQL injection, XSS, corruption données.
  Test : payload malformé → 400 + détails.

### Renforcement — Phase 2 (exemple, estimation 3h)

- [x] **Helmet.js configuré strictement** `apps/api/src/index.ts` (section « Renforcement — Phase 2 »)  
  CSP à nonce, HSTS, referrerPolicy deny + frameguard actifs depuis la refonte du middleware `createHelmetMiddleware`.  
  Test : `apps/api/src/index.security.test.ts` vérifie la présence des headers clés.
- [x] **Trust proxy sécurisé** `apps/api/src/index.ts` (section « Renforcement — Phase 2 »)  
  Production : crash si `TRUSTED_PROXY_IPS` est vide, sinon liste blanche IP/CIDR du reverse proxy (Clever Cloud ou autre) ; en dev seuls les réseaux privés sont autorisés.  
  Test : démarrage API sans variable → throw attendu.
- [x] **Database SSL obligatoire** `packages/database/src/client.ts` (section « Renforcement — Phase 2 »)  
  `?sslmode=require|verify-full` exigé en production, sinon démarrage bloqué (tests unitaires `packages/database/src/__tests__/client.test.ts`).  
  Test : `npm test -- packages/database` (cases sslmode=require/verify-full/prefer).
- [x] **Script génération secrets** `scripts/generate-secrets.sh`  
  ```bash
  #!/usr/bin/env bash
  generate_secret() {
    openssl rand -base64 64 | tr -d '\n'
  }
  echo "SESSION_SECRET=$(generate_secret)"
  echo "JWT_SECRET=$(generate_secret)"
  echo "JWT_REFRESH_SECRET=$(generate_secret)"
  ```
  Test : exécution → secrets forts (>=64 chars) pour `.env`.
- [x] **Visibilité PRO verrouillée** : `ProProfile.status` = source de vérité. Profils non `APPROVED` invisibles/inbookables (nearby, search, booking, créneaux).

### Monitoring & Traçabilité — Phase 3 (exemple, estimation 2h)

- [x] **Endpoint `/security/health`** (admin only)  
  Disponible via `apps/api/src/index.ts` (section « Monitoring & Traçabilité ») + Supertest `apps/api/src/index.security.test.ts`. Les issues listent automatiquement CORS, secrets, proxies et mode trusté ; la doc `SECURITY.md#Surveillance-securityhealth` explique comment peupler `ALLOWED_ORIGINS`/`TRUSTED_PROXY_IPS` et brancher un check HTTP.
- [x] **Audit logs actions sensibles**  
  `audit()` est désormais branché sur les presets de rôles admin, la modération des signalements et la purge RGPD (`apps/api/src/modules/admin/admin.controller.ts`). Les tests `admin.e2e.test.ts` vérifient la présence d'une trace (`admin:role:apply`, `admin:report:action`, `admin:gdpr:run-purge`) avant de considérer l'action réussie.
- [x] **Cron `/security/health`**  
  Script `scripts/security-health-check.sh` + workflow planifié `.github/workflows/security-health-monitor.yml` surveillent l'endpoint toutes les 30 min et notifient via webhooks configurable.

### Phase 4 — Gouvernance Admin & RGPD (exemple, etat a confirmer)

- [x] **RBAC admin basé sur les permissions (`adminProfile.permissions`)**  
  Étendre `requireAdmin` ou ajouter `requirePermission` afin que chaque route `/admin/*` impose les scopes définis dans `AVAILABLE_PERMISSIONS` (`apps/api/src/modules/admin/admin.controller.ts`, section « Phase 4 — Gouvernance Admin & RGPD »). À couvrir : suspension utilisateur (`users.suspend`), modération (`reports.moderate`), analytics (`analytics.view`), etc. Mettre à jour `openapi.yaml` + tests e2e (`admin.e2e.test.ts`) pour refléter la matrice CNIL.
- [x] **Journalisation des lectures de données personnelles**  
  Activer `audit()` (ou équivalent read-only) sur les endpoints de consultation massive (`GET /admin/users`, `/admin/users/:id`, `/admin/gdpr/*`, `/admin/stats`). Objectif : tracer qui lit quelles données sensibles, conformément aux exigences CNIL. Ajouter tests pour vérifier la création d’un `auditLog` lors d’une lecture admin.
- [x] **Migration `legal_consent_archive` compatible PostgreSQL**  
  Reprendre `packages/database/prisma/migrations/add_legal_consent_archive.sql` (dialecte MySQL) en migration Prisma/PostgreSQL + `ON CONFLICT`. Mettre à jour `gdprPurgeService` (`apps/api/src/services/gdpr-purge.service.ts`, section « Phase 4 — Gouvernance Admin & RGPD ») et `GET /admin/gdpr/legal-archive/:userId` pour utiliser la nouvelle table. Ajouter tests Prisma e2e.
- [x] **Finaliser purge RGPD & rotation des logs**  
  Implémenter la suppression des logs obsolètes (`oldLogsDeleted` TODO dans `gdprPurgeService`) + s’assurer que les jobs planifiés via `GDPR_PURGE_INTERVAL_HOURS`, `CONV_PURGE_INTERVAL_HOURS` et `GDPR_PURGE_RUN_ON_START` sont documentés/testés (`docs/deployment.md`, `SECURITY.md`). Ajouter un check `/admin/gdpr/compliance-report` qui échoue si les jobs ne tournent pas.
- [x] **Redis obligatoire pour le 2FA admin**  
  Supprimer le fallback `memoryStore` (`apps/api/src/services/two-factor.service.ts`, section « Phase 4 — Gouvernance Admin & RGPD ») en production : la génération/validation des codes doit dépendre d’un Redis sécurisé (`REDIS_URL` + mot de passe). Ajout d’un health-check Redis + doc mise à jour (`SECURITY.md`, `docs/deployment.md`).
- [x] **Aligner le backend sur les vues Admin existantes**  
  - Exposer un client `apiClient.updateAllowedIPs()` + page UI pour `PATCH /admin/admins/:id/allowed-ips`.  
  - Créer les endpoints réels pour les sections “Conversations bloquées”, “Tentatives de connexion suspectes” et “Logs de sécurité” (`apps/web/app/admin/dashboard/page.tsx` marque encore “Bientôt”).  
  - Documenter ces APIs dans `openapi.yaml` + ajouter tests Jest/Playwright dédiés.

### Checklist Pré-Déploiement Production (BLOQUANTE)

> 🚫 **Déploiement refusé** si un item **BLOCKER** est manquant.  
> Les variables d’environnement critiques doivent provoquer un **refus de démarrage** en production.

**Configuration (BLOCKER – 30 min)**
- [ ] **BLOCKER** — Générer secrets forts. _(Code : `ensureProductionSecrets` + `validateProductionEnv` refuse les valeurs par défaut.)_
- [ ] **BLOCKER** — Configurer `ALLOWED_ORIGINS`. _(Code : `validateProductionEnv` + `apps/api/src/index.ts` bloquent au démarrage si vide.)_
- [ ] **BLOCKER** — Configurer `TRUSTED_PROXY_IPS`. _(Code : `validateProductionEnv` bloque au démarrage si vide.)_
- [ ] **BLOCKER** — `DATABASE_URL` avec `sslmode=require`. _(Code : `validateProductionEnv` bloque au démarrage.)_
- [ ] **BLOCKER** — `REDIS_URL` + `REDIS_PASSWORD` non par défaut. _(Code : `validateProductionEnv` bloque au démarrage.)_
- [ ] **BLOCKER** — `TWO_FACTOR_SECRET` ≥ 32 caractères et non par défaut. _(Code : `validateProductionEnv` bloque au démarrage.)_
- [x] **BLOCKER** — `AUTH_REQUIRE_VERIFIED=true`. _(Process : vérifier via `/security/health` + tests e2e existants.)_
- [ ] **BLOCKER** — `NODE_ENV=production`. _(Process : vérification manuelle avant déploiement.)_

**Tests Sécurité (BLOCKER – 1h)**
- [ ] **BLOCKER** — `/security/health` → 200. _(Déploiement refusé si le check échoue.)_
  - [x] **Test automatisé** : `apps/api/src/index.security.test.ts` (supertest) couvre 401, 403 et 200 + payload côté admin.
- [ ] **BLOCKER** — CORS bloque domaines externes. _(Refus de déploiement si la whitelist n’est pas vérifiée.)_
  - [x] Préflight: mode strict `PREFLIGHT_STRICT=1` pour empêcher le SKIP du P0 “allowed origin”.
- [ ] **BLOCKER** — Rate limiting (429 sur `/auth/login`). _(Refus de déploiement si non vérifié.)_
  - [x] **Test automatisé** : scénario e2e `apps/api/src/modules/auth/__tests__/auth.e2e.test.ts` (6 logins rapides → 429).
- [ ] **BLOCKER** — CSRF bloque requêtes sans token. _(Refus de déploiement si non vérifié.)_
  - [x] **Test automatisé** : `apps/api/src/middleware/__tests__/csrf.test.ts` (requête cross-site sans cookie → `CSRF_NO_SECRET`).
- [ ] **BLOCKER** — JWT invalide → 401. _(Refus de déploiement si non vérifié.)_
  - [x] **Test automatisé** : `auth.e2e.test.ts` (appel `/auth/me` avec token corrompu → 401).
- [ ] **BLOCKER** — Endpoints admin accessibles uniquement par admin. _(Refus de déploiement si non vérifié.)_
  - [x] **Test Playwright** : `apps/web/tests/e2e/admin-access.spec.ts` (non connecté → /login, rider → /dashboard, admin → succès).
- [ ] **BLOCKER** — Consentement pubs ↔ AdSense. _(Refus de déploiement si non vérifié.)_
  - [x] **Test Playwright** : `apps/web/tests/e2e/ads-consent.spec.ts` (mode basique → placeholder, opt-in personnalisé → `<ins.adsbygoogle>`).

**Tests Redis & 2FA (BLOCKER – 30 min)**
- [ ] **BLOCKER** — Vérifier REDIS_PASSWORD non par défaut. _(Refus de déploiement si valeur par défaut.)_
- [ ] **BLOCKER** — Vérifier TWO_FACTOR_SECRET configuré. _(Refus de déploiement si valeur par défaut.)_
- [ ] **BLOCKER** — Tester 2FA rate limiting : 6 codes invalides → blocage 5 min. _(Refus de déploiement si non vérifié.)_
- [ ] **BLOCKER** — Vérifier aucun code 2FA en clair dans Redis. _(Refus de déploiement si non vérifié.)_
- [ ] **BLOCKER** — Vérifier invalidation cache sans KEYS(). _(Refus de déploiement si non vérifié.)_

**Monitoring (30 min)**
- [ ] Alertes 5xx via logs provider (Clever Cloud ou autre).
- [ ] Alertes 429 excessifs.
- [ ] Alertes 2FA rate-limit (monitoring `2fa:attempts:*` dans Redis).
- [ ] Dashboard 401/403/429 par endpoint.
- [ ] Revue hebdomadaire audit logs.
- [ ] Optimiser le compteur de messages non lus : supprimer le polling `/conversations` en prod au profit d'un flux temps réel (Socket.io) avec events d'update d'unread.
- [ ] Monitorer Redis : Aucune commande KEYS() en production (logs `redis-cli monitor`).

**Documentation (30 min)**
- [ ] `SECURITY.md` mis à jour.
- [x] `DEPLOYMENT.md` checklist env vars.
- [ ] Procédure incident sécurité.
- [ ] Contacts équipe sécurité.
- [x] **Mettre à jour `apps/web/public/.well-known/security.txt`** : Remplacer `METTRE_EMAIL_SECURITE_ICI_AVANT_PROD@example.com` par `security@blobinfini.com` (3 occurrences, section « Documentation (30 min) »). _Ce fichier est accessible publiquement via `https://votredomaine.com/.well-known/security.txt` selon le standard RFC 9116 pour permettre aux chercheurs en sécurité de signaler des vulnérabilités._

### SECURITY DONE

**Garanties apportées**
- Patchs P2 appliqués sur le profil PRO (coordonnées défensives, throttling consentement, logs dev-only).
- Validation Zod étendue à `query`/`params` disponible côté middleware + tests associés.
- Guard production au démarrage (`validateProductionEnv`) avec erreurs bloquantes sur variables critiques.
- Logging `validate` en production sans message brut (code + type uniquement).
- `security.txt` aligné sur l’email réel.
- Tests de non-régression ajoutés (UI profil PRO + middleware validate).

**Risques résiduels acceptés**
- Adoption progressive de la validation `query`/`params` dans les routes existantes (non modifiées ici).

**Limites connues**
- Pas d’ajout de jobs CI / scripts de déploiement dans ce périmètre restreint.

**Volontairement NON traité**
- Modifications fonctionnelles du système de notifications (hors périmètre autorisé).

### À TRAITER PLUS TARD — File d’attente sécurité (ROADMAP UNIQUEMENT)

**P2 — CORS hardening (processus + tests à ajouter)**
- Valider strictement les origins (schéma, trailing slash, `Origin: null`).
- Refuser explicitement `*` lorsque `credentials` est activé.
- Ajouter des tests d’abus : `Origin: null`, `file://`, `https://evil.com`.

**P2 — TRUSTED_PROXY_IPS hardening**
- Vérification usage réel anti-spoofing de `X-Forwarded-For`.
- Tests d’attaque spoof IP avec listes `TRUSTED_PROXY_IPS` partielles.
- Validation complète CIDR / IPv6 en prod (déjà supporté, tests d’abus à compléter).

**P3 — Logging production**
- Supprimer totalement les messages d’erreur utilisateur en production.
- Corrélation uniquement via `requestId` (pas de contenu d’erreur).

**P3 — CI / Build guards**
- Étape bloquante `npm run type-check`.
- Étape bloquante `npm run build`.
- Échec CI si env BLOCKER manquante ou valeurs par défaut détectées.

**Estimation temps total (exemple) :** ~9h (Phase 1 : 2h, Phase 2 : 3h, Phase 3 : 2h, Tests+Deploy : 2h).  
**Score cible post-fix (exemple) :** CORS, secrets, validation, headers → 9.3/10 global.

---

## 🧪 Tests & Qualité

### Couverture actuelle

- [x] Tests algorithme matching PostGIS (392 lignes, 31 cas).
- [x] Tests booking system validation (369 lignes, 55 cas).
- [x] Tests middleware sécurité (CSRF + rate limiting).
- [x] Tests matching cards React (utils, intégration, page).
- [x] Services core (cache/auth/push/2FA) – 100% couverture.
- [ ] Composants matching supplémentaires (améliorer coverage).
- [ ] Composants UI de base (50+ composants à couvrir).
  - [x] Button/Card/Dialog/Input/Toast déjà couverts.

### Priorités tests

- [x] Stabiliser E2E API (agg analytics NULLs + setup DB `RUN_E2E=1` + horaires booking).
- [x] Fiabiliser E2E admin security-patches (JWT direct, Prisma aligné, rate-limit test env).
- [ ] Tester composants UI manquants (Storybook + Jest/RTL).
- [ ] Nettoyer données Playwright (`Playwright Spot …`) avant `npm run test:e2e`.
- [ ] Gérer flux CSRF côté UI (cookie `connect.sid` avant `POST /booking/requests`).
- [ ] Ticket P1: CSRF requis uniquement si auth cookie/session (`connect.sid`); skip CSRF si `Authorization: Bearer` et pas de cookie (CSRF protège les cookies; header Bearer non auto‑envoyé cross‑site).
- [ ] Résoudre scénario E2E `Rider to pro booking flow – accept`.
- [ ] Atteindre **80%+ de couverture** (actuel ~75%).
- [ ] Ajouter tests de sécurité automatisés (CORS, CSRF, rate limit) dans la CI.
- [ ] Ajouter tests sécurité dans pipeline (section « Logging & Observabilité Production »).
- [ ] CI : installer navigateurs `npx playwright install` après chaque `npm install`.

### Documentation & Process

- Voir `docs/GUIDE_TESTS.md` pour architecture de tests.
- Checklist Contrats/UI systématique dans PR.
- Pas de masquage de tests flaky sans TODO/roadmap.

---

## ⚙️ Performance & UX

### Travaux réalisés

- [x] Indexes PostGIS pour requêtes géospatiales.
- [x] Optimisation N+1 matching (400+ → 5 requêtes).
- [x] Cache Redis (matching géo, profils, disponibilités).
- [x] Pagination cursor-based.
- [x] Carte matching mobile optimisée (swipe, haptics).
- [x] Loading skeletons généralisés.
- [x] Push notifications (service worker + Firebase FCM).
- [x] Contrôles d’accessibilité WCAG (skip link, annonceur de route, contraste élevé, préférences persistantes).

### Optimisations restantes

- [x] **Query batching DB** — Regrouper requêtes pour éviter N+1 et réduire latence. ✅ **COMPLÉTÉ**

  **📊 Analyse complète :** `docs/QUERY_BATCHING_ANALYSIS.md`

  - **Résultats de l'audit :**
    - ✅ **1 N+1 critique trouvé et corrigé** : `conversations.controller.ts` (40 → 4 requêtes, -90%)
    - ✅ **2 optimisations déjà en place** : `booking.service.ts` + `admin.controller.ts`
    - ✅ **Tous les autres modules** : Pas de N+1 détecté (patterns efficaces avec `include` et JOINs)

  - **✅ Correctif implémenté : Conversations Controller**
    ```typescript
    // AVANT : 40 requêtes pour 10 conversations (N×4)
    for (const cm of filteredConvs) {
      const user = await prisma.user.findUnique({ ... });       // 1 req
      const proProfile = await prisma.proProfile.findUnique({ ... }); // 1 req
      const riderProfile = await prisma.riderProfile.findUnique({ ... }); // 1 req
      const unread = await prisma.message.count({ ... });       // 1 req
    }

    // APRÈS : 4 requêtes totales (batch loading)
    const users = await prisma.user.findMany({ where: { id: { in: otherUserIds } } });
    const proProfiles = await prisma.proProfile.findMany({ where: { userId: { in: proIds } } });
    const riderProfiles = await prisma.riderProfile.findMany({ where: { userId: { in: riderIds } } });
    const unreadCounts = await prisma.$queryRaw`...GROUP BY conversationId`;

    // Maps pour lookup O(1)
    const userMap = new Map(users.map(u => [u.id, u]));
    // ... accès direct sans requêtes supplémentaires
    ```

  - **Impact mesuré :**
    - `/chat/conversations` : **-90% de requêtes** (40 → 4)
    - Latence estimée : **-80%** (~200ms → ~40ms)
    - Charge DB réduite sur endpoint critique

  - **Prochaines étapes (optionnel, si goulot d'étranglement) :**
    - [ ] Cache Redis pour conversations (si forte charge)
    - [ ] Service de batching réutilisable (`batch-loader.service.ts`)
    - [ ] Prisma Middleware auto-batching (expérimental, long terme)

- [x] **Optimisations Matching Module** — Supprimer requête redondante + enrichir données profils ✅ **COMPLÉTÉ**

  **✅ Correctifs implémentés :**

  1. **✅ Requête PostGIS redondante supprimée** (`matching.controller.ts`, section « Optimisations Matching Module »)
     ```typescript
     // AVANT : 2 requêtes PostGIS (double charge DB)
     const rows = await prisma.$queryRaw`...LIMIT ${effectiveLimit}`;
     const fullResults = await prisma.$queryRaw`...LIMIT 200`; // REDONDANT !

     // APRÈS : 1 seule requête + pagination en JS
     const rows = await prisma.$queryRaw`...LIMIT 200`;
     const excludeSet = new Set(req.body.excludeIds || []);
     const filteredResults = allResults.filter(r => !excludeSet.has(r.id));
     const actualResults = filteredResults.slice(startIndex, endIndex);
     await cacheService.setMatchingResults(cacheKey, allResults, 300);
     ```
     **Gain :** **-50% de requêtes PostGIS** (de 2 à 1 par recherche non cachée)

  2. **✅ Données profils enrichies** (photoUrl + bio ajoutés)
     ```sql
     SELECT
       rp."id", rp."displayName", rp."sex",
       rp."photoUrl",  -- ✅ AJOUTÉ
       rp."bio",       -- ✅ AJOUTÉ
       rd."sport", rd."level",
       rp."wantsLesson", rp."lessonSport",
       ST_Distance(...) AS dist_m
     FROM "RiderProfile" rp
     JOIN "RiderDiscipline" rd ON ...
     ```
     **Impact :** Frontend peut maintenant afficher photos et bios sans requêtes additionnelles

  3. **✅ Paramètre `partner` nettoyé** (filtre genre complètement supprimé)
     - ✅ Supprimé de `searchSchema`
     - ✅ Supprimé parsing `partnerPref`
     - ✅ Supprimé variable `criteria.partnerPref`
     - ✅ Supprimé `${genderCond}` des requêtes SQL
     - ℹ️ Le champ `sex` reste dans la réponse (affiché dans les cartes)

  **📊 Impact mesuré :**
  - Endpoint `/matching/search` : **-50% de charge DB PostGIS**
  - API enrichie : `photoUrl` et `bio` maintenant disponibles
  - Code simplifié : **-15 lignes** (paramètre gender inutilisé supprimé)
  - Pagination optimisée : Filtrage et slicing en JS (plus rapide que SQL)

  **✅ Frontend mis à jour** (`apps/web/app/matching/cards/page.tsx`, section « Optimisations Matching Module »)
    - ✅ Photo de profil affichée (64×64px, rounded-full avec fallback 👤)
    - ✅ Bio affichée dans un cadre stylisé (italic, bg-muted)
    - ✅ Layout amélioré avec flexbox pour photo + infos
    - ✅ Style shadcn/ui conservé (border, muted, spacing)
    - ✅ Boutons Accepter/Refuser/Signaler intacts
    - ✅ Gestion du genre améliorée (Femme/Homme/Autre)

- [x] **Optimisations Module Offres Pro** — PostGIS ✅ **DÉJÀ IMPLÉMENTÉ**

  **✅ État Actuel (2025-12-30) :**

  1. **✅ `/near/lessons` utilise DÉJÀ PostGIS correctement** (`pro.controller.ts`, section « Optimisations Module Offres Pro »)
     - Utilise `ST_DWithin` pour filtrer AVANT de charger les données
     - Calcul distance en **SQL avec PostGIS** (optimal)
     - CTE pour optimiser les comptages de matches actifs
     - **Implémentation actuelle :** Pattern PostGIS optimal déjà en place

     ```typescript
     // ✅ CODE ACTUEL (DÉJÀ OPTIMISÉ)
     const candidates = await prisma.$queryRaw`
       WITH active_matches AS (...),
       match_counts AS (SELECT "userId", COUNT(*) AS total ...)
       SELECT
         rp."id", rp."displayName",
         ST_Distance(...) / 1000.0 AS "distanceKm",
         COALESCE(mc.total, 0) AS "activeMatchCount"
       FROM "RiderProfile" rp
       LEFT JOIN match_counts mc ON mc."userId" = rp."userId"
       WHERE ST_DWithin(...)  -- ✅ Filtre géospatial AVANT
       ORDER BY "distanceKm" ASC
       LIMIT 500
     `;
     ```

  2. **✅ Middleware `requireProRole` DÉJÀ créé** (`pro.guard.ts`, section « Optimisations Module Offres Pro »)
     - Middleware réutilisable déjà implémenté et utilisé
     - Appliqué sur tous les endpoints PRO
     - **Code actuel :** `proRouter.use(requireAuth, requireVerifiedEmail)` + `requireProRole` sur routes sensibles

  3. **✅ `/near/lessons` utilise CTE + LEFT JOIN (optimal)**
     - CTE `match_counts` + LEFT JOIN déjà implémenté (section « Optimisations Module Offres Pro »)
     - Pas de sous-requêtes N+1, optimisation déjà faite

  **📝 Note sur l'architecture actuelle :**
  - ✅ Le système utilise **`booking/availability`** au lieu de `ProOffer` (obsolète)
  - ✅ Endpoints actuels (tous avec PostGIS optimisé) :
    - `/booking/availability/search` - Rider cherche des disponibilités PRO
    - `/booking/requests` - Rider fait une demande de cours (lesson-request)
    - `/booking/requests/inbox` - PRO reçoit les demandes
    - `/booking/pros/nearby` - Recherche géolocalisée de PROs
  - ℹ️ Le modèle `ProOffer` (`schema.prisma`, section « Optimisations Module Offres Pro ») est **legacy** et reste pour compatibilité GDPR export uniquement

  **📊 Résultat :**
  - ✅ Toutes les optimisations PostGIS déjà en place
  - ✅ Middleware `requireProRole` déjà créé et utilisé
  - ✅ Requêtes optimisées avec CTE et LEFT JOIN
  - ℹ️ Module PRO déjà optimal, aucune action requise

- [x] Lazy loading données non critiques (AdBanner, CookieConsent en `next/dynamic`).
- [x] **Compression Gzip/Brotli** ✅ (`apps/api/src/index.ts`, section « Performance & UX »)
  - Compression middleware déjà activé avec niveau 6 (bon équilibre)
  - Filtre personnalisé pour contrôle granulaire
  - Supporte header `x-no-compression` pour désactivation si nécessaire
- [x] **Connection pooling PostgreSQL optimisé** ✅ **CONFIGURÉ** (2025-12-30)
  - Prisma utilise un pool par défaut (10 connections)
  - **Optimisation appliquée :** `.env.example` + `deployment.md` documentés
  - Configuration recommandée : `?connection_limit=20&pool_timeout=20&connect_timeout=10`
  - **Impact :** Gère ~2000 req/min au lieu de ~600 req/min sans pooling
  - **À faire en prod :** Copier la configuration depuis `.env.example` (section « Performance & UX »)
- [ ] Pré-calcul distances populaires (materialized views).
- [ ] **CDN Cloudflare gratuit** 💰 **PRIORITÉ PROD** ⚠️ Attendre nom de domaine

  **🎯 À configurer une fois le domaine acheté :**

  1. **Créer compte Cloudflare** (gratuit) : https://dash.cloudflare.com/sign-up

  2. **Ajouter le domaine** (ex: `blobinfini.com`)
     - Cloudflare fournit 2 nameservers (ex: `ns1.cloudflare.com`, `ns2.cloudflare.com`)
     - Aller chez le registrar (OVH, Namecheap, etc.) et remplacer les DNS par ceux de Cloudflare
     - Attendre propagation DNS (24-48h max)

  3. **Configurer SSL/TLS** (dans Cloudflare Dashboard)
     - SSL/TLS → Overview → Mode "Full (strict)"
     - Edge Certificates → Always Use HTTPS : ON
     - Edge Certificates → Minimum TLS Version : 1.2

  4. **Activer optimisations gratuites**
     - Speed → Optimization → Auto Minify : Cocher JS, CSS, HTML
     - Speed → Optimization → Brotli : ON
     - Speed → Optimization → Rocket Loader : OFF (peut casser React)
     - Caching → Configuration → Browser Cache TTL : 4 hours

  5. **Configurer règles de cache pour images** (Page Rules gratuites : 3 max)
     - Règle 1 : `blobinfini.com/api/assets/*` → Cache Level: Cache Everything, Edge Cache TTL: 1 month
     - Règle 2 : `blobinfini.com/*.jpg` → Cache Everything, Edge Cache TTL: 1 month
     - Règle 3 : `blobinfini.com/*.png` → Cache Everything, Edge Cache TTL: 1 month

  6. **Mettre à jour variables d'env production**
     ```bash
     # Dans .env.production
     ALLOWED_ORIGINS=https://blobinfini.com,https://www.blobinfini.com
     WEB_BASE_URL=https://blobinfini.com
     ```

  **📊 Gains estimés :**
  - 🌍 **-60% latence** images (CDN mondial avec 300+ datacenters)
  - 💾 **-50% bande passante** MinIO/S3 (économie coûts)
  - 🚀 **Auto-minify** JS/CSS/HTML (gratuit)
  - 🔒 **Protection DDoS** automatique (gratuit)
  - 📈 **100 GB/mois gratuit** (largement suffisant pour MVP)

  **⏱️ Temps config :** 30 min (une fois le domaine acheté)
- [x] Automatiser déploiement (GitHub Actions build/test prêt).
- [x] Cache service consent (`getConsent` en mémoire 5 min).

  **✅ Correctif livré (2025-12-15)**

  - [x] Verrouillage d'une seule offre par pro (contrainte `ProOffer_proProfileId`, upsert API + bouton d'application des filtres côté riders pour éviter les incohérences).

---

## 🛠 Developer Experience & Observabilité

- [x] Documentation OpenAPI/Swagger (`openapi.yaml`, Swagger UI, lint CI).
- [x] Storybook v8.0.10 + tests visuels (7/7 OK).
- [x] Collection Postman partagée.
- [x] Monitoring performance gratuit (Clever Cloud ou alternative).
- [x] Docs Storybook (`docs/storybook.md`).
- [ ] Analytics dashboard métriques techniques (open source).
- [ ] Endpoint `/security/health` (Phase 3 - exemple sécurité).
- [ ] Audit logs actions sensibles.
- [ ] Compression/déploiement automatisé.

---

## 📝 Logging & Observabilité Production

### État actuel (Décembre 2025)

**✅ Corrections logging appliquées :**
- [x] Suppression des logs de debug polluants (`console.log` → supprimés)
- [x] Correction logique erreurs : Ne plus logger les erreurs 400 (validation) comme des 500
- [x] Migration vers `secureLogger` (format structuré + redaction données sensibles)
- [x] **Fichiers corrigés :**
  - `pro.controller.ts` : 36 console.* remplacés
  - `admin.controller.ts` : 35 console.error remplacés
  - `booking.service.ts` : 8 console.* remplacés
  - `matching.controller.ts` : 2 console.log supprimés
- [x] **Tests validation :** 433 tests passent, zéro régression

**🎯 Impact des corrections :**
- ✅ **Aucune pollution prod** : Logs de debug supprimés (recherches, cache hit/miss, notifications)
- ✅ **Logs propres** : Seulement erreurs serveur (500), sécurité (rate limiting), warnings (cache failures)
- ✅ **Format structuré** : Timestamps, contexte, redaction automatique (tokens, emails, passwords)
- ✅ **Fausses alertes éliminées** : Les erreurs de validation client (400) ne polluent plus les logs

**📊 Volume estimé en production (usage normal) :**
- **Erreurs serveur (500)** : < 10/jour (si code stable)
- **Alertes sécurité** : Dépend des abus (rate limiting)
- **Warnings** : < 50/jour (cache Redis temporairement indisponible)
- **Total :** ~100-200 lignes/jour en conditions normales

### Pistes d'amélioration à considérer

**🔍 Audit & Analyse (2-3h)**
- [ ] **Inventaire complet des `secureLogger.*` restants**
  - Lister tous les appels `secureLogger.error()`, `.warn()`, `.security()` dans le code
  - Classifier par criticité et fréquence estimée
  - Valider que chaque log est justifié et apporte de la valeur
  - Documenter les scénarios qui déclenchent chaque log

- [ ] **Estimation volume logs par scénario**
  - Simuler 1000 utilisateurs/jour avec comportement normal
  - Calculer volume logs attendu (lignes/jour, MB/jour)
  - Identifier les endpoints qui génèrent le plus de logs
  - Projeter coûts stockage si agrégation externe (Datadog, Sentry)

**🗂️ Système de logging fichiers (3-4h)**
- [ ] **Configuration logging production-ready**
  - Implémenter rotation automatique des logs (par jour/taille)
  - Séparer logs par niveau (error.log, warning.log, security.log)
  - Configurer rétention (30 jours pour erreurs, 7 jours pour warnings)
  - Compression automatique des logs anciens (.gz)
  - Exemple de structure :
    ```
    /var/log/blobinfini/
    ├── api-error.log          # Erreurs serveur (500)
    ├── api-security.log       # Alertes sécurité (rate limiting, CORS blocks)
    ├── api-warning.log        # Warnings non-bloquants
    ├── api-error-2025-12-01.log.gz  # Archives compressées
    └── api-security-2025-12-01.log.gz
    ```

- [ ] **Script d'analyse logs**
  - Parser les logs structurés (JSON) pour statistiques
  - Détecter patterns d'abus (rate limiting répétés)
  - Alertes automatiques si erreurs 500 > seuil
  - Rapport quotidien par email/Slack

**☁️ Service d'agrégation de logs (4-6h setup)**

**Option 1 : Gratuit/Low-cost**
- [ ] **Grafana Loki** (self-hosted, open source)
  - Coût : 0€ (hébergement Docker + provider gratuit)
  - Recherche rapide, visualisation temps réel
  - Intégration Grafana pour dashboards
  - Rétention configurable

- [ ] **Graylog** (open source)
  - Coût : 0€ (self-hosted)
  - Interface web puissante
  - Recherche Elasticsearch-like
  - Alertes configurables

**Option 2 : Services cloud (payant)**
- [ ] **Datadog** (monitoring pro)
  - Coût : ~50-150€/mois selon volume
  - Logs + APM + métriques + alertes
  - Excellent pour tracking erreurs et performance
  - Intégration CI/CD, dashboard avancés

- [ ] **Sentry** (focus erreurs)
  - Coût : 0-26€/mois (tier gratuit généreux)
  - Spécialisé tracking erreurs avec contexte
  - Sourcemaps, breadcrumbs, release tracking
  - Alertes temps réel par email/Slack

- [ ] **LogRocket** (session replay)
  - Coût : 99-399€/mois
  - Rejeu sessions utilisateur avec erreurs
  - Utile pour debug UX complexes
  - Overkill pour MVP, à considérer post-lancement

**Recommandation startup (exemple) :**
```
Phase 1 (exemple, MVP) : Logs fichiers + Sentry Free (0-26€/mois)
Phase 2 (exemple, Croissance) : Grafana Loki self-hosted (0€)
Phase 3 (exemple, Scale) : Datadog si budget permet (50-150€/mois)
```

### Priorités recommandées

**🚨 URGENT (avant production)**
- [ ] Inventaire `secureLogger.*` pour validation audit

**⚡ QUICK WIN (1-2j)**
- [ ] Logs fichiers avec rotation basique
- [ ] Sentry integration (tier gratuit)

**📈 MOYEN TERME (post-lancement)**
- [ ] Grafana Loki self-hosted
- [ ] Dashboard métriques logs (volume, taux erreur)

**💰 LONG TERME (si croissance)**
- [ ] Datadog full-stack observability
- [ ] Alerting avancé sur patterns d'abus

### Coûts estimés

| Solution | Setup | Coût mensuel | Avantages | Inconvénients |
|----------|-------|--------------|-----------|---------------|
| **Logs fichiers** | 1-2h | 0€ | Contrôle total, gratuit | Pas de recherche avancée |
| **Sentry Free** | 1h | 0€ | Excellent pour erreurs | Limité à 5k événements/mois |
| **Sentry Team** | 1h | 26€ | Tracking complet | Coût récurrent |
| **Grafana Loki** | 4-6h | 0€ | Puissant, flexible | Maintenance self-hosted |
| **Datadog** | 2-3h | 50-150€ | Tout-en-un, excellent | Cher pour startup |
| **LogRocket** | 2h | 99-399€ | Session replay unique | Overkill pour MVP |

**💡 Stratégie optimale startup :**
- Démarrer avec **logs fichiers + Sentry Free** (0€)
- Migrer vers **Grafana Loki** si besoin recherche avancée (0€)
- Passer à **Datadog** seulement si croissance forte et budget dispo

---

## 📢 Monétisation (Publicité)

- [x] Infrastructure AdSense prête (`ADSENSE_READY_TO_DEPLOY.md`).
- [ ] Créer compte Google AdSense + variables d’env.
- [ ] Déploiement production (`ADSENSE_DEPLOYMENT.md`).
- [x] Bannière RGPD intelligente. ✅ **COMPLÉTÉ** (`CookieConsent.tsx` avec 3 niveaux)
- [x] CNIL: journalisation serveur du consentement cookies (version + timestamp). ✅ **COMPLÉTÉ**
- [x] CNIL: page publique RGPD/cookies mise à jour (docs + partenaires). ✅ **COMPLÉTÉ** (`/about`)
- [x] CNIL: audit scripts pubs/analytics (chargement bloqué tant que pas de consentement). ✅ **COMPLÉTÉ**
- [x] CNIL: harmoniser le bandeau (refus = acceptation en visibilité, apparition ≤1s). ✅ **COMPLÉTÉ**
- [x] CNIL: parcours d'exercice des droits (export/suppression) accessible self-service. ✅ **COMPLÉTÉ**

### Système RGPD Complet (Export & Suppression) ✅ **COMPLÉTÉ**

**📦 Implémentation complète du droit à la portabilité (Art. 20) et droit à l'effacement (Art. 17)**

**🎯 Fonctionnalités implémentées :**

1. **📥 Export de données RGPD** - Article 20 (Droit à la portabilité)
   - [x] Service d'export complet (`gdpr-export.service.ts` - 548 lignes)
   - [x] Endpoint `/profile/export` (riders) avec rate limiting (3/heure)
   - [x] Endpoint `/pro/export` (pros) avec rate limiting (3/heure)
   - [x] Protection DoS : Limites de requêtes (10k messages, 1k conversations, etc.)
   - [x] Conformité P0 : Redaction contenu messages reçus (RGPD Art. 5.1.c)
   - [x] Optimisation : `_count` SQL au lieu de chargement arrays
   - [x] Logging metrics : Détection abus + surveillance volumétrie
   - [x] Format JSON téléchargeable avec nom de fichier daté
   - [x] Boutons frontend intégrés dans profils (rider + pro)
   - [x] **Dashboard Admin** : Monitoring exports (`/admin/gdpr-exports`)
     - Statistiques : Total, 24h, 7j, 30j
     - Exports par rôle (30 jours)
     - Top 10 exporteurs
     - Historique complet avec filtres (userId, dates)
     - Pagination + détails (IP, taille, items)

2. **🗑️ Suppression de compte avec période de grâce** - Article 17 (Droit à l'effacement)
   - [x] Endpoints riders (`/profile/delete-account`, `/cancel-deletion`, `/deletion-status`)
   - [x] Endpoints pros (`/pro/delete-account`, `/cancel-deletion`, `/deletion-status`)
   - [x] Délai de rétractation de 30 jours (recommandation CNIL)
   - [x] Modal explicatif avec processus en 4 étapes
   - [x] Compte à rebours dynamique (X jours restants)
   - [x] Validation backend : Impossible d'annuler après 30 jours
   - [x] Traçabilité : Logs dans `AuditLog` (IP, dates, métadonnées)
   - [x] UX claire : Bouton change d'état selon statut suppression
   - [ ] **Cron job suppression finale** (après 30 jours) - ⚡ PRIORITÉ
   - [ ] Notifications email (demande, rappels, confirmation)

**📊 Données exportées :**
- Profil utilisateur (rider ou pro)
- Disciplines & préférences
- Conversations (metadata + messages envoyés)
- Matches acceptés/refusés
- Réservations (rider) ou demandes (pro)
- Disponibilités (pros uniquement)
- Offres professionnelles (pros uniquement)
- Demandes de contact
- Transactions (si applicable)
- Logs d'audit (100 derniers)
- Consentements cookies

**🔐 Sécurité & Conformité :**
- ✅ **RGPD Article 20** : Portabilité des données "fournies par" l'utilisateur
- ✅ **RGPD Article 5(1)(c)** : Minimisation - Messages reçus redactés
- ✅ **CNIL Best Practice** : Période de grâce 30 jours (comme Gmail/Facebook)
- ✅ **Protection DoS** : Limites volumétriques + rate limiting
- ✅ **Traçabilité complète** : Audit logs pour conformité légale
- ✅ **Monitoring administrateur** : Dashboard temps réel des exports
- ✅ **Performance** : SQL COUNT au lieu de chargement mémoire

**📁 Fichiers modifiés/créés :**
- `apps/api/src/services/gdpr-export.service.ts` (nouveau - 548 lignes)
- `apps/api/src/modules/profile/profile.controller.ts` (section « Système RGPD Complet »)
- `apps/api/src/modules/pro/pro.controller.ts` (section « Système RGPD Complet »)
- `apps/api/src/modules/admin/admin.controller.ts` (section « Système RGPD Complet »)
- `apps/web/app/profile/page.tsx` (export + suppression UI)
- `apps/web/app/pro/profile/page.tsx` (export + suppression UI)
- `apps/web/app/admin/gdpr-exports/page.tsx` (nouveau - dashboard monitoring)

**🚀 Prochaines étapes :**
- [x] **Cron job suppression finale** - Script quotidien pour purge après 30 jours ✅ **COMPLÉTÉ**
  - ✅ Script TypeScript avec mode DRY-RUN (`cleanup-deleted-accounts.ts`)
  - ✅ Service Docker cron (`api-cron` dans `docker-compose.yml`)
  - ✅ Exécution quotidienne à 2h du matin (gratuit)
  - ✅ Logs persistants avec rétention 30 jours
  - ✅ Documentation complète (`GDPR_CLEANUP.md`)
- [ ] **Emails notifications** - Confirmation, rappels, annulation
- [ ] **Tests E2E complets** - Flux export + suppression + annulation
- [ ] **P2 Optionnel** : Centraliser rate limiter, pseudonymiser emails matches, pretty-print JSON

**💰 Coût cron job : GRATUIT ✅**
- ✅ **Implémenté avec Docker cron** (solution choisie)
- Pas de service cloud payant
- Pas de limites d'exécution
- Logs stockés localement

**🛠️ Architecture Cron Job :**
```
apps/api/
├── scripts/
│   ├── cleanup-deleted-accounts.ts  # Script principal (209 lignes)
│   ├── cleanup-cron.sh             # Wrapper bash pour Docker
│   └── test-cleanup.sh             # Test en mode DRY-RUN
├── crontab                         # Config cron (quotidien 2h)
├── Dockerfile.cron                 # Dockerfile service cron
├── GDPR_CLEANUP.md                 # Documentation complète
└── logs/                           # Logs persistants (30j rétention)
```

**⚙️ Fonctionnement du Cleanup :**
1. Recherche comptes avec `deletedAt > 30 jours`
2. Anonymisation données personnelles :
   - Email → `deleted_<userId>_<timestamp>@anonymized.blobinfini.com`
   - Password → Hash invalide
   - Profils → Noms génériques, photos/bio supprimées
   - Géolocalisation → Effacée
3. Suppression définitive :
   - Messages envoyés (contenu personnel)
   - Tokens (email, reset, refresh, sessions)
4. Traçabilité :
   - Log dans `AuditLog` pour conformité RGPD
   - Conservation `deletedAt` + logs d'audit

**🔒 Détails Techniques Importants :**
- **Singleton Prisma** : Utilise `import { prisma } from '@blobinfini/database'`
  - Réutilise instance existante (pas de nouvelle connexion DB)
  - Hérite config centralisée (logs, pool, graceful shutdown)
  - Évite fuites mémoire et connexions orphelines
- **Mode DRY-RUN** : Variable `DRY_RUN=true` pour simulation sans modification
- **Logs automatiques** : Adaptatifs selon `NODE_ENV` (dev: verbose, prod: errors only)

  **📋 Intégration RGPD Complète : Section Privacy dans `/profile`**

  **Fichier :** `apps/web/app/profile/page.tsx` (section « Intégration RGPD Complète »)

  **Fonctionnalités ajoutées :**

  1. **🗺️ Gestion Géolocalisation**
     - Affichage position enregistrée (lat/lng avec 4 décimales)
     - Info transparente sur usage (matching + offres)
     - Bouton "Supprimer ma position" avec confirmation
     - Message si pas de géolocalisation avec lien vers activation
     - **Conformité :** Droit à l'effacement (Art. 17 RGPD)

  2. **🍪 Préférences Cookies**
     - Bouton "Gérer mes cookies" → rouvre modal `CookieConsent.tsx`
     - Mécanisme : supprime cookie `cookie_consent` + reload page
     - **Conformité :** Droit de modification du consentement

  3. **📄 Droits RGPD**
     - Lien vers politique RGPD publique (`/about`)
     - Export données (placeholder → API `/profile/export` à créer)
     - Suppression compte avec double confirmation (contact support)
     - **Conformité :** Transparence + droits d'accès, portabilité, effacement

  **Design :**
  - Card dédiée "🔒 Confidentialité et Données" en bas du profil
  - 3 sous-sections séparées par `<hr>` avec icônes lucide-react
  - Style shadcn/ui cohérent avec le reste de l'interface
  - Responsive et accessible

  **Avantages UX :**
  - ✅ Tout centralisé dans profil (pas de dispersion dashboard/pages séparées)
  - ✅ Informations claires et transparentes (conformité CNIL)
  - ✅ Actions directes (pas besoin de chercher les réglages)

  **Prochaines étapes RGPD :**
  - [ ] Implémenter API `/profile/export` pour export réel des données (JSON + CSV)
  - [ ] Ajouter workflow automatisé de suppression de compte (avec délai légal 7j + anonymisation)
  - [ ] Ajouter historique des consentements cookies dans le profil utilisateur

- [ ] Analytics revenus (suivi partenaires).
- [ ] Partenariats marques surf/kite (une fois audience).
- **ROI estimé :** 50-300€/mois (quick win).

---

## 💤 Fonctionnalités en Pause / Backlog Stratégique

### Paiements & Crédit (⏸️ EXCLU DU MVP - Décision Oct 2025)

**Décision stratégique :** Simplifier le MVP en excluant complètement le système de paiement.
**Rationale :** Focus sur matching/booking + monétisation publicitaire AdSense uniquement.

- [ ] Intégration Stripe Connect
- [ ] Calcul commissions
- [ ] Factures PDF
- [ ] Gestion remboursements
- [ ] Workflow business (Stripe/Credits)

3**À réévaluer :** Post-MVP si besoin monétisation additionnelle (pas avant 3-6 mois).

### Gamification (⏸️ EXCLU DU MVP - Décision Oct 2025)

**Décision stratégique :** Pas de système de flocons d'avoine ou points dans le MVP.
**Rationale :** Simplifier l'UX et se concentrer sur les fonctionnalités core.

- [ ] Système de points/flocons
- [ ] Badges et achievements
- [ ] Leaderboards
- [ ] Récompenses engagement

**À réévaluer :** Si besoin d'augmenter engagement utilisateur (post-MVP).

### Module Blobosphère (Editorial)

- [ ] CMS pour articles sport/bien-être.
- [ ] Interface admin publication.
- [ ] SEO + partage social.
- [ ] Intégration matching.

### Analytics Avancées

- [x] Dashboard complet admins (preuves de valeur RGPD-safe).
  - [x] Cohortes riders/pros + stickiness + TTFV.
  - [x] Marketplace health (supply/demand, acceptation, delai).
  - [x] Trust & Safety + Blobosphere analytics agreges.
- [ ] Métriques conversion matching→booking.
- [ ] Analyse géographique utilisateurs.
- [ ] Reporting pro (revenus, planning).
- [ ] Grafana/Prometheus self-hosted (objectif 200€/mois économisés).

### Fonctionnalités avancées

- [x] 2FA pour pros (TOTP email + contrôle d'accès renforcé).
- [ ] Chat vocal/vidéo.
- [ ] Système de reviews post-session.
- [ ] ML amélioration matching.

---

## 👥 Répartition Équipe Recommandée

### Sécurité (1-2 jours, 0€) – Priorité absolue

- Historique (nov 2025, tel qu'indiqué ici) : Phase 1 (2h, exemple) : CORS, secrets, logs, validation – ✅ livré.
- Historique (nov 2025, tel qu'indiqué ici) : Phase 2 (3h, exemple) : Helmet, trust proxy, DB SSL, script secrets – ✅ livré.
- Historique (nov 2025, tel qu'indiqué ici) : Phase 3 (2h, exemple) : `/security/health`, audit logs, alerting – ✅ livré (script + doc monitoring).
- Tests (2h, exemple) : Checklist sécurité complète – 🔄 à rejouer avant déploiement.

### Claude (Backend/Performance)

- URGENT : Sécurité Phase 3 (exemple) (checklists + observabilité).
- En cours : Optimisations DB, compression.
- Suivant : CDN + monitoring production.

### Codex (Frontend/Infrastructure)

- URGENT : Scripts secrets + docs sécurité/déploiement.
- En cours : OpenAPI docs, Storybook, tests UI.
- Suivant : Analytics dashboard.

### Quick wins après sécurité

- Déploiement AdSense.
- Module Blobosphère (SEO).
- Analytics avancées (backlog).

---

## 📊 ROI & Efforts

| Tâche | Effort | Impact Business | Impact Technique | Status | 💰 Économies |
|-------|--------|-----------------|------------------|---------|-------------|
| ~~Sécurité CSRF/Rate~~ | ~~2j~~ | ~~🔥 Critique~~ | ~~🔥 Critique~~ | ✅ Terminé | 0€ |
| ~~Cache Redis~~ | ~~3j~~ | ~~⚡ Performance~~ | ~~⚡ Performance~~ | ✅ Terminé | 0€ |
| ~~Push Notifications~~ | ~~5j~~ | ~~📱 Engagement~~ | ~~🎯 PWA~~ | ✅ Terminé | 0€ |
| ~~AdSense Infrastructure~~ | ~~1j~~ | ~~💰 Revenus immédiat~~ | ~~🎯 Monétisation~~ | ✅ Terminé | 0€ |
| ~~Tests Services Core~~ | ~~3j~~ | ~~🛡️ Qualité~~ | ~~🛡️ Stabilité~~ | ✅ Terminé | 0€ |
| ~~Monitoring Gratuit (Clever Cloud ou autre)~~ | ~~0.5j~~ | ~~🛡️ Production~~ | ~~🛡️ Stabilité~~ | ✅ Terminé | **300€/an** |
| **Sécurité Production-Ready** | **1-2j** | **🔥 BLOCKER PROD** | **🔥 Critique** | 🚨 URGENT | **0€** |
| ├─ Phase 1 (exemple) : CORS + Secrets + Validation | 2h | 🔥 Critique | 🔥 Critique | ✅ Terminé | 0€ |
| ├─ Phase 2 (exemple) : Helmet + SSL + Scripts | 3h | 🛡️ Important | 🛡️ Important | ✅ Terminé | 0€ |
| ├─ Phase 3 (exemple) : Monitoring + Audit Logs | 2h | 📊 Important | 📊 Important | 🚨 Focus (alerting) | 0€ |
| └─ Tests + Checklist Déploiement (exemple) | 2h | ✅ Validation | ✅ Validation | 🚨 Final | 0€ |
| Optimisations Performance Gratuites | 1j | ⚡ Performance | 🛡️ Stabilité | 🔥 En cours | 0€ |
| ~~Storybook Fix + OpenAPI~~ | ~~1j~~ | ~~📚 DevExp~~ | ~~🛠️ Infrastructure~~ | ✅ Terminé | 0€ |
| Déploiement AdSense | 5min | 💰 Revenus 50-300€/mois | 🎯 Business | ⚡ Quick Win | 0€ |
| Tests UI + Analytics Dashboard | 2j | 📱 UX + 📊 Insights | 🛡️ + 🎯 Business | 🎯 Suivant | 0€ |
| Workflow Paiement (pause) | ?j | 💰 Revenus core | 🎯 Business | ⏸️ Pause | 0€ |
| Module Blobosphère | 10j | 📈 SEO/Engagement | 🎯 Fonctionnel | 🚀 Croissance | 0€ |
| Analytics avancées | 6j | 📊 Insights | 🎯 Business | 📈 Scale | **200€/mois** |

---

## ⚠️ Risques & Pistes d’Amélioration

### Issues critiques

- CORS wildcard, secrets faibles, logs sensibles, validation Zod incomplète.
- Helmet basique, pas d’enforcement SSL, audit logs manquants.
- Couverture UI faible, flux E2E partiellement cassés.
- Analytics business limitées, CI/CD manuel.

### Pistes d’amélioration priorisées

1. Verrouiller sécurité (CORS, secrets, validation, headers, audit logs).
2. Industrialiser tests UI/E2E (clean data, CSRF flow, couverture 80%+).
3. Automatiser observabilité (dashboards, alertes, `/security/health`).
4. Optimiser coûts/performance (compression, CDN, pooling).
5. Industrialiser monétisation publicitaire (AdSense live + analytics revenus).

---

## 📋 Tickets & Répartition (Détail)

### Sécurité Production-Ready (Claude & Codex)

**Claude #1 – Phase 1 (exemple, 2h)**
- [x] Fix CORS wildcard.
- [x] Validation secrets production.
- [x] Supprimer logs tokens.
- [x] Middleware validation Zod.

**Claude #2 – Phase 2 (exemple, 3h)**
- [x] Helmet renforcé (CSP, HSTS).
- [x] Trust proxy provider (Clever Cloud ou autre).
- [x] DB SSL obligatoire.
- [x] Script génération secrets.

**Codex #1 – Phase 3 (exemple, 2h)**
- [x] Endpoint `/security/health`.
- [x] Schema + middleware audit logs.
- [x] Mettre à jour `SECURITY.md`.
- [x] Mettre à jour `DEPLOYMENT.md`.

**Codex #2 – Tests & Validation (2h)**
- [ ] Tests sécurité automatisés.
- [ ] Checklist pré-déploiement.
- [ ] Scripts validation config production.
- [ ] CI : ajouter tests sécurité.

### Après sécurité

- **Claude #3 :** Observabilité provider (dashboards, alertes, rotation logs).
- **Claude #4 :** Optimisations DB (pooling, batching) + CDN.
- **Codex #3 :** Documentation OpenAPI (term.) ✅.
- **Codex #4 :** Storybook composants (term.) ✅.

---

## 🎯 Métriques de Succès

### Immédiat (1-2 jours)

- [ ] Sécurité 7.0/10 → 9.3/10.
- [ ] Tests sécurité checklist OK.
- [ ] Documentation sécurité/déploiement à jour.
- [ ] Script secrets opérationnel.

### Court terme (1 mois)

- [ ] Couverture tests 80%+.
- [ ] Performance : CDN + connection pooling.
- [ ] Sécurité : Audit logs + alertes.
- [ ] UX mobile : Lighthouse 90+.

### Moyen terme (3 mois)

- [ ] Paiements : **à replanifier** (en pause).
- [ ] Editorial : CMS Blobosphère live.
- [ ] Analytics : Dashboard complet.
- [ ] Engagement : +40% rétention utilisateurs.

---

## 💰 Économies Stack 100% Gratuite

- Monitoring (Clever Cloud ou autre) : 0€.
- Analytics futures : Grafana/Prometheus self-hosted (objectif 200€/mois d’économie).
- CDN : Cloudflare free tier (50€/mois économisés).
- Total estimé : ~2 700€/an réinvestis dans les features business.

---

## 🗓️ Mémo

- **Dernière mise à jour :** 31 décembre 2025.
- **Branch actuelle :** `feat/storybook-react-webpack5`.
- **Derniers travaux :** Refonte Redis complète (cache + invalidation sécurisée + 2FA durci) ✅
- **Prochaine étape urgente :** Tests sécurité checklist pré-déploiement (1h) – BLOCKER avant déploiement.
- **Étapes normales ensuite :** Déploiement AdSense (5 min) | Analytics dashboard (Codex).
