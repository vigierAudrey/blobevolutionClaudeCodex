# 🚀 Roadmap de Développement Blobinfini

---

## 🧭 Vision & Stratégie

- **Philosophie 100% Open Source & Gratuit :** Monitoring Clever Cloud + dashboards libres, infrastructure low-cost, outils open source-first pour réinvestir dans les fonctionnalités.
- **Positionnement MVP :** Fonctionner sans système de paiement — la monétisation initiale repose sur la publicité (AdSense) et sur la consolidation de l’expérience matching.
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

1. **🔒 Sécurité Production-Ready (Phase 1+2 en priorité)**  
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

- [ ] **CORS wildcard (*)** `apps/api/src/index.ts:14-21`  
  ```typescript
  // ❌ ACTUEL
  res.setHeader('Access-Control-Allow-Origin', '*');

  // ✅ FIX
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [];
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  ```
  Impact : XSS cross-site, vol de tokens, CSRF bypass.  
  Test : `curl -H "Origin: https://evil.com" ...` doit échouer.

- [ ] **Secrets par défaut faibles** `apps/api/src/index.ts:85` + `apps/api/src/modules/auth/auth.service.ts:71,76`  
  ```typescript
  if (process.env.NODE_ENV === 'production') {
    const requiredSecrets = ['SESSION_SECRET', 'JWT_SECRET', 'JWT_REFRESH_SECRET'];
    for (const secret of requiredSecrets) {
      if (!process.env[secret] || process.env[secret].length < 32) {
        throw new Error(`${secret} must be set and >= 32 chars in production`);
      }
    }
  }
  ```
  Impact : Session hijacking, JWT forgery.  
  Test : démarrer l’API en prod sans secrets doit échouer.

- [ ] **Logs de tokens sensibles** `apps/api/src/services/push-notification.service.ts`  
  ```typescript
  // ❌ ACTUEL
  console.log(`💾 Saving FCM token: ${token.substring(0, 20)}...`);

  // ✅ FIX
  console.log(`💾 Saving FCM token for user ${userId}`);
  ```
  Impact : reconstruction token, notification hijacking.  
  Test : `rg "console.log.*token" apps/api/src/services/push-notification.service.ts` ne doit rien retourner.

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
- [ ] **Script génération secrets** `scripts/generate-secrets.sh`  
  ```bash
  #!/bin/bash
  echo "JWT_SECRET=$(openssl rand -base64 64 | tr -d '\n')"
  ```
  Test : exécution → secrets forts.

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
- [ ] Générer secrets forts.
- [ ] Configurer `ALLOWED_ORIGINS`.
- [ ] Configurer `TRUSTED_PROXY_IPS`.
- [ ] `DATABASE_URL` avec `sslmode=require`.
- [ ] `REDIS_URL` avec mot de passe fort.
- [ ] `AUTH_REQUIRE_VERIFIED=true`.
- [ ] `NODE_ENV=production`.

**Tests Sécurité (1h)**
- [ ] `/security/health` → 200.
- [ ] CORS bloque domaines externes.
- [ ] Rate limiting (429 sur `/auth/login`).
- [ ] CSRF bloque requêtes sans token.
- [ ] JWT invalide → 401.
- [ ] Endpoints admin accessibles uniquement par admin.

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

- [ ] Query batching DB.
- [ ] Lazy loading données non critiques.
- [ ] Compression Gzip/Brotli.
- [ ] Connection pooling PostgreSQL optimisé.
- [ ] Pré-calcul distances populaires (materialized views).
- [ ] CDN gratuit (Cloudflare) pour assets statiques & images profils.
- [ ] Automatiser déploiement (GitHub Actions + Clever Cloud).

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
- [ ] Bannière RGPD intelligente.
- [ ] Analytics revenus (suivi partenaires).
- [ ] Partenariats marques surf/kite (une fois audience).
- **ROI estimé :** 50-300€/mois (quick win).

---

## 💤 Fonctionnalités en Pause / Backlog Stratégique

### Paiements & Crédit (mis en pause)

- [ ] Intégration Stripe Connect.
- [ ] Calcul commissions.
- [ ] Factures PDF.
- [ ] Gestion remboursements.
- [ ] Workflow business (Stripe/Credits).
- Rappel : rester sur modèle publicitaire pour MVP.

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

- [ ] 2FA pour pros.
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

