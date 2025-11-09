# 🚀 Roadmap de Développement Blobinfini

---

## 🧭 Vision & Stratégie

- **Philosophie 100% Open Source & Gratuit :** Monitoring Clever Cloud + dashboards libres, infrastructure low-cost, outils open source-first pour réinvestir dans les fonctionnalités.
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

## 📊 Indicateurs Actuels

- **Score Santé global :** 9.0/10 ⬆️ (+0.5) – Stack 100% gratuite.
- **Tests :** 498 tests (17 fichiers) – Couverture ~75%.
- **Sécurité :** 7.0/10 ⚠️ à renforcer (CORS, secrets, logs, validation).
- **Performance :** Optimisations majeures complétées ✅.
- **PWA :** Push notifications + Service Worker + Offline ✅.
- **Monitoring :** Clever Cloud logs + standards (0€) ✅.

---

## 🎯 Priorités Immédiates (Vue Synthétique)

**Note :** Le module Auth est maintenant ✅ **COMPLÉTÉ** avec 100% des fonctionnalités prévues (register, login, 2FA, reset, CSRF, rate limiting, tests).

1. **🔒 Sécurité Production-Ready (Phase 1+2 en priorité)** - BLOCKER PROD
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

### État actuel

- **Score Sécurité :** 7.0/10 | **Objectif :** 9.5/10 avant production.
- **Protections existantes :**
  - [x] CSRF protection complète sur tous les endpoints mutants.
  - [x] Rate limiting Redis (Auth 5/15min, Registration 3/h, API 100/15min, Search 30/min, Upload 10/10min, Messaging 10/min).
  - [x] RGPD : purge automatique en 3 phases (7j → 2 ans → 10 ans).
  - [x] JWT avec rotation/invalidation des refresh tokens.
  - [x] Bcrypt coût 12 pour les mots de passe.
  - [x] Helmet.js basique.

### Vulnérabilités critiques — Phase 1 (Blockers Production – 2h)

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

- [ ] **Validation d’entrée incomplète**  
  ```typescript
  // apps/api/src/middleware/validate.ts
  export function validate(schema: z.ZodSchema) {
    return (req, res, next) => {
      const result = schema.safeParse({
        body: req.body,
        query: req.query,
        params: req.params
      });
      if (!result.success) {
        return res.status(400).json({
          error: 'VALIDATION_ERROR',
          details: result.error.errors
        });
      }
      next();
    };
  }
  ```
  Impact : SQL injection, XSS, corruption données.  
  Test : payload malformé → 400 + détails.

### Renforcement — Phase 2 (3h)

- [ ] **Helmet.js configuré strictement** `apps/api/src/index.ts:97`  
  CSP, HSTS, referrerPolicy renforcés.  
  Test : `securityheaders.com`.
- [ ] **Trust proxy sécurisé** `apps/api/src/index.ts:72-81`  
  Production : IPs Clever Cloud via `TRUSTED_PROXY_IPS`.  
  Test : `req.ip` reflète bien l’IP client.
- [ ] **Database SSL obligatoire** `.env.production`  
  `?sslmode=require`.  
  Test : connexion sans SSL doit échouer.
- [x] **Script génération secrets** `scripts/generate-secrets.sh`  
  ```bash
  #!/usr/bin/env bash
  echo "SESSION_SECRET=$(openssl rand -base64 64 | tr -d '\n')"
  echo "JWT_SECRET=$(openssl rand -base64 64 | tr -d '\n')"
  echo "JWT_REFRESH_SECRET=$(openssl rand -base64 64 | tr -d '\n')"
  ```
  Test : exécution → secrets forts (>=64 chars) pour `.env`.

### Monitoring & Traçabilité — Phase 3 (2h)

- [ ] **Endpoint `/security/health`** (admin only)  
  Vérifie CORS, secrets, Redis, DB SSL, proxies.
- [ ] **Audit logs actions sensibles**  
  ```typescript
  await prisma.auditLog.create({
    data: {
      userId: req.user.id,
      action: 'USER_ROLE_CHANGED',
      resourceType: 'User',
      resourceId: targetUserId,
      metadata: { oldRole, newRole },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    }
  });
  ```
  Test : actions admin apparaissent dans la table.

### Checklist Pré-Déploiement Production

**Configuration (30 min)**
- [ ] Générer secrets forts. _(Actuel : `.env` et `.env.example` gardent `please-change-in-dev`; exécuter `./scripts/generate-secrets.sh` et injecter les valeurs en prod.)_
- [ ] Configurer `ALLOWED_ORIGINS`. _(Actuel : aucune valeur définie ; en prod l’API planterait, mais prévoir la liste CSV des domaines front.)_
- [ ] Configurer `TRUSTED_PROXY_IPS`. _(Actuel : variable absente ; à compléter avec les IP/CIDR du reverse proxy avant mise en prod.)_
- [ ] `DATABASE_URL` avec `sslmode=require`. _(Actuel : chaînes locales sans `sslmode`; forcer `?sslmode=require` côté env prod.)_
- [ ] `REDIS_URL` avec mot de passe fort. _(Actuel : `change-me-strong`; générer un secret robuste et mettre à jour l’URL.)_
- [ ] `AUTH_REQUIRE_VERIFIED=true`. _(Actuel : flag à `false` dans `.env`; à activer pour obliger la vérification email.)_
- [ ] `NODE_ENV=production`. _(Actuel : dév local en `development`; vérifier que le déploiement exporte `NODE_ENV=production`.)_

**Tests Sécurité (1h)**
- [ ] `/security/health` → 200. _(Non vérifié : requiert session admin et `ALLOWED_ORIGINS/TRUSTED_PROXY_IPS` renseignés ; à exécuter sur staging ou prod.)_
  - [x] **Test automatisé** : `apps/api/src/index.security.test.ts` (supertest) couvre 401, 403 et 200 + payload côté admin.
- [ ] CORS bloque domaines externes. _(Non vérifié : prévoir `curl -H "Origin: https://evil.com"` → 403 une fois la whitelist définie.)_
- [ ] Rate limiting (429 sur `/auth/login`). _(Non vérifié : lancer scénario 6 tentatives rapides pour confirmer `AUTH` profile.)_
  - [x] **Test automatisé** : scénario e2e `apps/api/src/modules/auth/__tests__/auth.e2e.test.ts` (6 logins rapides → 429).
- [ ] CSRF bloque requêtes sans token. _(Couverture Jest existante, mais pas retesté manuellement post-refonte 2FA.)_
  - [x] **Test automatisé** : `apps/api/src/middleware/__tests__/csrf.test.ts` (requête cross-site sans cookie → `CSRF_NO_SECRET`).
- [ ] JWT invalide → 401. _(Non vérifié : appeler `/profile/me` avec token altéré pour confirmer rejet.)_
  - [x] **Test automatisé** : `auth.e2e.test.ts` (appel `/auth/me` avec token corrompu → 401).
- [ ] Endpoints admin accessibles uniquement par admin. _(Tests E2E présents, prévoir exécution `npm test -w @blobinfini/api` avant go-live.)_
  - [x] **Test Playwright** : `apps/web/tests/e2e/admin-access.spec.ts` (non connecté → /login, rider → /dashboard, admin → succès).
- [ ] Consentement pubs ↔ AdSense. _(Nouvelle exigence CNIL : bannière doit bloquer AdSense tant que pas d’opt-in.)_
  - [x] **Test Playwright** : `apps/web/tests/e2e/ads-consent.spec.ts` (mode basique → placeholder, opt-in personnalisé → `<ins.adsbygoogle>`).

**Monitoring (30 min)**
- [ ] Alertes Clever Cloud 5xx.
- [ ] Alertes 429 excessifs.
- [ ] Dashboard 401/403/429 par endpoint.
- [ ] Revue hebdomadaire audit logs.

**Documentation (30 min)**
- [ ] `SECURITY.md` mis à jour.
- [ ] `DEPLOYMENT.md` checklist env vars.
- [ ] Procédure incident sécurité.
- [ ] Contacts équipe sécurité.

**Estimation temps total :** ~9h (Phase 1 : 2h, Phase 2 : 3h, Phase 3 : 2h, Tests+Deploy : 2h).  
**Score cible post-fix :** CORS, secrets, validation, headers → 9.3/10 global.

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

- [ ] Tester composants UI manquants (Storybook + Jest/RTL).
- [ ] Nettoyer données Playwright (`Playwright Spot …`) avant `npm run test:e2e`.
- [ ] Gérer flux CSRF côté UI (cookie `connect.sid` avant `POST /booking/requests`).
- [ ] Résoudre scénario E2E `Rider to pro booking flow – accept`.
- [ ] Atteindre **80%+ de couverture** (actuel ~75%).
- [ ] Ajouter tests de sécurité automatisés (CORS, CSRF, rate limit) dans la CI.
- [ ] Ajouter tests sécurité dans pipeline (`ROADMAP.md:576`).
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

  1. **✅ Requête PostGIS redondante supprimée** (`matching.controller.ts:206-270`)
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

  **✅ Frontend mis à jour** (`apps/web/app/matching/cards/page.tsx:429-475`)
    - ✅ Photo de profil affichée (64×64px, rounded-full avec fallback 👤)
    - ✅ Bio affichée dans un cadre stylisé (italic, bg-muted)
    - ✅ Layout amélioré avec flexbox pour photo + infos
    - ✅ Style shadcn/ui conservé (border, muted, spacing)
    - ✅ Boutons Accepter/Refuser/Signaler intacts
    - ✅ Gestion du genre améliorée (Femme/Homme/Autre)

- [ ] **Optimisations Module Offres Pro** — PostGIS + middleware + batch loading ⚠️ **PRIORITÉ**

  **🔴 Problèmes identifiés :**

  1. **❌ CRITIQUE : `/offers/search` n'utilise PAS PostGIS** (`pro.controller.ts:331-452`)
     - Charge **1000 offres** en mémoire avec `findMany({ take: 1000 })`
     - Calcul distance en **JavaScript** avec Haversine (lent)
     - Filtre par rayon **APRÈS** avoir tout chargé
     - **Comparaison :** Le matching utilise PostGIS et filtre AVANT (5-10× plus rapide)

     ```typescript
     // PROBLÈME ACTUEL
     const offers = await prisma.proOffer.findMany({ take: 1000 });
     const filtered = offers
       .map(o => ({ ...o, distance: haversine(...) }))  // ❌ Calcul JS
       .filter(o => o.distance <= radiusKm);            // ❌ Filtre après

     // SOLUTION : PostGIS comme le matching
     const offers = await prisma.$queryRaw`
       SELECT ..., ST_Distance(...) AS distance_km
       WHERE ST_DWithin(..., ${radiusKm * 1000})  -- ✅ Filtre AVANT
       ORDER BY distance_km ASC
       LIMIT 50
     `;
     ```

  2. **❌ Requêtes `user.findUnique` redondantes** (4× dans le fichier)
     - Lignes 183, 208, 274, 304 : Même requête pour vérifier `role === 'PRO'`
     - **Solution :** Créer middleware `requireProRole` réutilisable

     ```typescript
     // AVANT : Répété 4 fois
     const user = await prisma.user.findUnique({ where: { id: userId } });
     if (user?.role !== 'PRO') return res.status(403).json({ error: 'Forbidden' });

     // APRÈS : Middleware
     export const requireProRole = async (req, res, next) => { ... };
     proRouter.post('/offers', requireAuth, requireProRole, async (req, res) => {
       // Plus de vérification nécessaire !
     });
     ```

  3. **⚠️ `/near/lessons` : Sous-requêtes COUNT inefficaces** (ligne 126-133)
     - 2 sous-requêtes `SELECT COUNT(*)` par rider pour `activeMatchCount`
     - **Solution :** LEFT JOIN + GROUP BY au lieu de sous-requêtes

     ```sql
     -- AVANT : N sous-requêtes
     (SELECT COUNT(*) FROM "Match" m1 WHERE m1."userOneId" = rp."userId") +
     (SELECT COUNT(*) FROM "Match" m2 WHERE m2."userTwoId" = rp."userId")

     -- APRÈS : LEFT JOIN
     LEFT JOIN "Match" m ON (m."userOneId" = rp."userId" OR m."userTwoId" = rp."userId")
     GROUP BY rp."id"
     ```

  **🛠️ Correctifs à implémenter :**

  - [ ] **Optimiser `/offers/search` avec PostGIS (Priorité 1)** ⭐
    - Remplacer Haversine JS par `ST_Distance` PostgreSQL
    - Utiliser `ST_DWithin` pour filtrer AVANT le fetch
    - Réduire de 1000 offres → 50 offres pertinentes
    - **Gain estimé :** **5-10× plus rapide** + **-95% de données chargées**

  - [ ] **Créer middleware `requireProRole` (Priorité 2)**
    - Extraire vérification rôle PRO dans middleware réutilisable
    - Appliquer sur tous les endpoints PRO (`/offers/*`, `/near/lessons`)
    - **Gain :** Code DRY, -4 requêtes redondantes, -20 lignes

  - [ ] **Optimiser `/near/lessons` COUNT (Priorité 3)**
    - Remplacer sous-requêtes COUNT par LEFT JOIN + GROUP BY
    - **Gain :** Évite N sous-requêtes, performance sur gros volumes

  **📊 Impact estimé :**
  - Endpoint `/offers/search` : **5-10× plus rapide** (PostGIS vs Haversine)
  - Charge mémoire : **-95%** (50 offres au lieu de 1000)
  - Requêtes DB : **-4 vérifications user** (middleware)
  - Code : **-20 lignes** (DRY avec middleware)
  - Cohérence : Même pattern que le matching (PostGIS)

- [x] Lazy loading données non critiques (AdBanner, CookieConsent en `next/dynamic`).
- [ ] Compression Gzip/Brotli.
- [ ] Connection pooling PostgreSQL optimisé.
- [ ] Pré-calcul distances populaires (materialized views).
- [ ] CDN gratuit (Cloudflare) pour assets statiques & images profils.
- [x] Automatiser déploiement (GitHub Actions build/test prêt).
- [x] Cache service consent (`getConsent` en mémoire 5 min).

---

## 🛠 Developer Experience & Observabilité

- [x] Documentation OpenAPI/Swagger (`openapi.yaml`, Swagger UI, lint CI).
- [x] Storybook v8.0.10 + tests visuels (7/7 OK).
- [x] Collection Postman partagée.
- [x] Monitoring performance gratuit Clever Cloud.
- [x] Docs Storybook (`docs/storybook.md`).
- [ ] Analytics dashboard métriques techniques (open source).
- [ ] Endpoint `/security/health` (Phase 3 sécurité).
- [ ] Audit logs actions sensibles.
- [ ] Compression/déploiement automatisé.

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
- `apps/api/src/modules/profile/profile.controller.ts` (lignes 240-460)
- `apps/api/src/modules/pro/pro.controller.ts` (lignes 471-663)
- `apps/api/src/modules/admin/admin.controller.ts` (lignes 1678-1894)
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

  **Fichier :** `apps/web/app/profile/page.tsx` (lignes 279-383)

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

- [ ] Dashboard complet admins.
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

- Phase 1 (2h) : CORS, secrets, logs, validation.
- Phase 2 (3h) : Helmet, trust proxy, DB SSL, script secrets.
- Phase 3 (2h) : `/security/health`, audit logs.
- Tests (2h) : Checklist sécurité complète.

### Claude (Backend/Performance)

- URGENT : Sécurité Phase 1+2.
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
| ~~Monitoring Gratuit Clever Cloud~~ | ~~0.5j~~ | ~~🛡️ Production~~ | ~~🛡️ Stabilité~~ | ✅ Terminé | **300€/an** |
| **Sécurité Production-Ready** | **1-2j** | **🔥 BLOCKER PROD** | **🔥 Critique** | 🚨 URGENT | **0€** |
| ├─ Phase 1 : CORS + Secrets + Validation | 2h | 🔥 Critique | 🔥 Critique | 🚨 Prio 1 | 0€ |
| ├─ Phase 2 : Helmet + SSL + Scripts | 3h | 🛡️ Important | 🛡️ Important | 🚨 Prio 2 | 0€ |
| ├─ Phase 3 : Monitoring + Audit Logs | 2h | 📊 Important | 📊 Important | 🚨 Prio 3 | 0€ |
| └─ Tests + Checklist Déploiement | 2h | ✅ Validation | ✅ Validation | 🚨 Final | 0€ |
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

**Claude #1 – Phase 1 (2h)**
- [ ] Fix CORS wildcard.
- [ ] Validation secrets production.
- [ ] Supprimer logs tokens.
- [ ] Middleware validation Zod.

**Claude #2 – Phase 2 (3h)**
- [ ] Helmet renforcé (CSP, HSTS).
- [ ] Trust proxy Clever Cloud.
- [ ] DB SSL obligatoire.
- [ ] Script génération secrets.

**Codex #1 – Phase 3 (2h)**
- [ ] Endpoint `/security/health`.
- [ ] Schema + middleware audit logs.
- [ ] Mettre à jour `SECURITY.md`.
- [ ] Mettre à jour `DEPLOYMENT.md`.

**Codex #2 – Tests & Validation (2h)**
- [ ] Tests sécurité automatisés.
- [ ] Checklist pré-déploiement.
- [ ] Scripts validation config production.
- [ ] CI : ajouter tests sécurité.

### Après sécurité

- **Claude #3 :** Observabilité Clever Cloud (dashboards, alertes, rotation logs).
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

- Monitoring Clever Cloud : 0€.
- Analytics futures : Grafana/Prometheus self-hosted (objectif 200€/mois d’économie).
- CDN : Cloudflare free tier (50€/mois économisés).
- Total estimé : ~2 700€/an réinvestis dans les features business.

---

## 🗓️ Mémo

- **Dernière mise à jour :** 12 octobre 2025.
- **Branch actuelle :** `fix/ci-prisma-db-push`.
- **Prochaine étape urgente :** Sécurité Production-Ready (Phase 1+2, 5h) – BLOCKER avant déploiement.
- **Étapes normales ensuite :** Optimisations performance gratuites (Claude) | Analytics dashboard (Codex).
