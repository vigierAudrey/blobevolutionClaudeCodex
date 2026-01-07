# 🏄 Guide IA – Blobinfini (nom interne) / BlobConnect (nom visible)

Ce fichier guide nos IA (Codex, ChatGPT-5, Claude Code) dans le développement du monorepo. À lire avant chaque session de code.

> **Note :** ce document remplace l'ancien `CLAUDE.md`. Tous les liens internes doivent désormais pointer vers `claude.md`.

---

## 🏷️ Naming produit (IMPORTANT)

- **BlobConnect** = nom **visible utilisateurs** (UI, emails, pages publiques, wording marketing).
- **Blobinfini** = nom **interne/tech** (repo, namespaces, packages) tant qu’aucune décision de renommage globale n’est actée.
- Ne pas “renommer en masse” (variables, packages, env, Sentry, Firebase, URLs) sans ticket/validation : risque casse SEO, config, observabilité, clés, routes.
- Dans les textes UI, toujours afficher **BlobConnect** (ex : titres, meta, emails, onboarding).

---

## 📌 Contexte Projet

**BlobConnect** (user-facing) / **Blobinfini** (interne) = plateforme communautaire de mise en relation pour sports de glisse (surf/kitesurf).

### Fonctionnalités clés

- **Matching** : Algorithme multi-critères (géoloc, niveau, dispo) pour connecter riders.
- **Réservation** : Mise en relation riders/pros pour cours.
- **Sécurité riders** : Contrôle d'identité pro obligatoire avant session.
- **Social** : Messagerie temps réel, groupes, favoris, système de réputation.
- **Blobosphère** : Hub éditorial SEO pour contenus communautaires.
- **BloboMap** : Carte interactive pour pros/spots.
- **Modèle économique** : Association loi 1901, financée par publicité et sponsors.
- **Paiement en ligne** : désactivé temporairement (mise en relation uniquement pour le MVP).

---

## 🫧 Philosophie Blobinfini

- 🌍 **Sobriété numérique** : code léger, dépendances open-source et hébergement français pour limiter l’empreinte carbone.
- 🧭 **Utilité avant tout** : chaque ligne doit améliorer l’expérience rider/pro ou simplifier l’opérationnel.
- 🕊️ **Accessibilité & inclusion** : mobile-first, contrastes respectés et parcours compatibles WCAG 2.1 AA.
- 🔐 **Éthique & RGPD** : aucun dark pattern, consentement explicite, données personnelles minimisées.
- ⚙️ **Robustesse > nouveauté** : on privilégie un MVP stable plutôt qu’une fonctionnalité inachevée.
- 🤝 **Apprentissage collectif** : commits lisibles, documentation à jour et commentaires pédagogiques lorsqu’une logique est subtile.

---

## 🧠 Comportement attendu des IA

### Lecture & préparation (OBLIGATOIRE)

- Lire **au moins 3 fichiers** proches avant toute modification : l’implémentation, un test, et un usage analogue (ou doc).
- Inspecter systématiquement les imports pour identifier DTO, services partagés, conventions typées.
- Vérifier la cohérence **API ↔ UI ↔ tests** (OpenAPI, Zod, types partagés) avant de proposer un changement.
- Identifier les invariants sécurité liés à la zone touchée (auth, RBAC, tokens, upload, UGC, ads, RGPD).

### Contributions attendues

- Suivre le workflow AGENTS : persona explicite, plan clair (>1 étape), exploration avant code, tests annoncés.
- Chaque proposition inclut : explication, justification, extrait cohérent, plan de test (ou raison de son absence).
- Tout changement fonctionnel entraîne la mise à jour des documents concernés (README, claude.md, ROADMAP, docs/*).
- Toujours vérifier `ROADMAP.md` avant de démarrer et y consigner les contributions si applicable.

### Outils & patterns obligatoires

- Valider toutes les entrées avec **Zod** côté API (DTO) et synchroniser les types partagés (`types/`, `apps/web/types`, `packages/database`, et tout package partagé existant).
- Utiliser **Prisma** et les services existants : pas de SQL brut ni de bypass des couches métier.
- Côté frontend, passer par `apps/web/lib/apiClient.ts` (gestion CSRF, tokens, retry) au lieu de `fetch` direct.
- Réutiliser les composants **Shadcn/Tailwind** situés dans `apps/web/components/ui/*`.
- Les préférences d’accessibilité (contraste, police, animations) sont centralisées dans `apps/web/components/accessibility/AccessibilityProvider`.
- Les logs passent par `secureLogger` (ou utilitaires existants), jamais `console.*` en production.

### Interdits immédiats (P0)

- Aucun secret ni donnée personnelle en clair dans le code, les fixtures ou les tests.
- Pas de cookies, tracking ou publicité sans consentement CMP explicite.
- Ne jamais supprimer une validation Zod ni affaiblir un guard de sécurité sans validation sécurité/produit.
- Pas d’ajout de champs paiement/marketing sans décision produit documentée + revue RGPD.
- Pas d’introduction de sink XSS : `dangerouslySetInnerHTML` interdit (sauf cas ultra cadré + sanitation + tests).

### Support & diagnostic

- Proposer les commandes/logs/tests pertinents (ex. `npm run test`, `npm run openapi:lint`, `docker logs -f blobinfini-api`) lors d’un triage.
- Remonter immédiatement toute ambiguïté documentaire ou divergence détectée dans le code.

### Mini-règles anti-hallucinations

- Toujours citer les fichiers/références du repo utilisés comme source lorsqu’on argumente.
- Vérifier la présence réelle d’une dépendance/outil (package.json, docs) avant de l’évoquer.
- Limiter la portée des modifications et expliciter toute hypothèse ou inconnue dans la PR.
- Escalader vers l’humain quand une consigne est ambiguë/contradictoire.

---

## 🧯 Anti “code pansement” (STRICT)

### Interdiction `any` (obligation projet)

- `any` est **interdit** (code, tests, docs).
- Utiliser `unknown` + type guards (`typeof`, `in`, `zod`, fonctions `isX()`).
- Si un `any` semble “nécessaire”, c’est presque toujours un signe qu’il manque :
  - un type partagé,
  - un helper de parsing,
  - ou une validation Zod.
- Exception rarissime uniquement si :
  1) encapsulé dans **une seule** fonction utilitaire,
  2) alternative refusée expliquée (`unknown` + guards),
  3) tests ajoutés,
  4) commentaire `// EXCEPTION_ANY: <raison> <lien fichier/issue>`.

### Heuristiques : pas de faux positifs

- Toute heuristique (auth/ws/errors parsing, UA detection, feature flags…) doit avoir :
  - tests positifs **et** tests anti-faux-positifs,
  - normalisation claire (trim, case-insensitive),
  - aucun affichage/log d’erreurs brutes pouvant contenir PII/tokens.

### Docs : snippets fiables

- Les snippets docs doivent être :
  - copiés depuis le code réel (ou pointer vers fichier + lignes),
  - jamais réécrits à la main.
- Toute divergence doc/code = bug P1 minimum.

---

## ✅ Definition of Done Sécurité (DoD) – s’applique automatiquement

### Quand s’applique ?

Dès qu’une PR touche : auth, sessions, RBAC/ABAC, websocket, tokens, headers, upload/UGC, API routes, cookies/CORS/CSRF, ads/consent, logs/observabilité.

### Référentiels à respecter (minimum)

- **OWASP Top 10 (Web)**
- **OWASP API Security Top 10**
- **OWASP ASVS** : Niveau 1 minimum, Niveau 2 si auth/PII/roles/administration.
- **OWASP Cheat Sheet Series** : JWT, Session, CSP, CORS, Password Storage, etc.
- **Mozilla Web Security Guidelines** : CSP, cookies, TLS, headers.
- **SLSA / dependency hygiene** : lockfiles, pinning, scanning, PRs de dépendances.

### Front hardening (Next.js)

- Vérifier headers : CSP, HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy.
- Interdit d’introduire une nouvelle sink XSS (HTML non trusted).
- Interdit de stocker des secrets côté client.
- Tokens : éviter `localStorage` si possible ; si contrainte => justification + mitigations (CSP stricte, audit XSS, etc.).

### API hardening

- Validation stricte (Zod) + limites de taille (payload, pagination).
- Contrôle d’accès serveur (jamais “front only”).
- Rate-limit (par IP hash + user + route), anti-abus, pagination obligatoire.
- CORS strict ; CSRF si cookies ; idempotency sur actions critiques.

### Supply chain / dépendances

- Toute nouvelle dépendance :
  - justification + alternatives rejetées,
  - lockfile à jour,
  - scanning (`npm audit` / équivalent) si dépendances modifiées,
  - pinning/versioning cohérent,
  - licence compatible.

### Tests / CI obligatoires (à exécuter et reporter)

Toujours exécuter **et mentionner explicitement** dans la PR :
- `npm run test`
- `npm run type-check`
- `npm run build`

Exigences additionnelles selon zone touchée :
- Auth/WS : single-flight refresh, reconnect idempotent, anti-boucle, UI error wiring, tests anti-faux-positifs.
- RBAC : tests “deny by default” + tests par rôle/ressource.
- Headers/CSP : test d’intégration (au minimum snapshot/config) + doc mise à jour.

### Format de réponse final (IA)

La réponse finale DOIT inclure :
- fichiers modifiés (liste)
- commandes exécutées
- checklist DoD cochée
- risques P0 restants + next step

---

## 🧩 Boîte à outils IA (commandes clés)

| Commande | Usage |
| --- | --- |
| `npm run dev:all` | Lance API (4000) + Web (3002) avec watchers et hot reload |
| `npm run type-check` | Vérification TypeScript stricte sur API + Web |
| `npm run lint` | ESLint + règles Next.js côté frontend |
| `npm run test` | Tests Jest côté API (unitaires/intégration, target 80% coverage) |
| `npm run test:e2e` | Scénarios Playwright sur les parcours critiques |
| `npm run openapi:lint` | Validation du schéma OpenAPI (`docs/openapi/openapi.yaml`) |
| `npm run db:seed` | Recharge la base de démo (Prisma seed) |
| `npm run db:studio` | Ouvre Prisma Studio pour inspection/migration |
| `npm run storybook` | Lancement Storybook pour développement composants UI |
| `npm run storybook:test` | Validation visuelle + snapshots UI (objectif 70% coverage frontend) |

⚠️ **Tests obligatoires avant PR** :
- Modules critiques (auth, matching, bookings, blobosphère, ads) : `npm run test` + `npm run test:e2e` + `npm run storybook:test` si UI modifiée.
- Pour toute modification d'un module critique, citer explicitement les commandes exécutées/recommandées.

**Bootstrap rapide**
```bash
npm install
cp .env.example .env
docker compose up -d
npm run dev:all
```

**Base de données**
```bash
npm run db:migrate
npm run db:seed
npm run db:reset
npm run db:reseed
npm run db:studio
```

---

## 🧭 Source de vérité & IA

- Ce monorepo (`blobevolutionClaudeCodex`) est la **source unique de vérité**.
- **Ne consultez plus** l'ancien projet `/blobevolution` (archivé pour référence historique uniquement).
- Les documents de référence IA sont **README.md**, **AGENTS.md** et **claude.md** ; tout écart avec le code doit être signalé par une PR doc.
- Pour le contexte historique : `ai/context/migration_from_blobevolution.md` sans en déduire de code.
- 🎯 Focus visibilité : la Blobosphère est notre vitrine éditoriale pour attirer du trafic et des inscriptions.

---

## 📘 Contrats API & UI

### Modification contrats API

- Mettre à jour `openapi.yaml` (ou `.json`) avec endpoints, schémas, codes d'erreur et exemples réalistes.
- Vérifier que l'UI Swagger (ex. `/api/docs`) se charge sans erreur et reflète les changements.
- Synchroniser DTO/validations Zod (`apps/api`) + types partagés (`types/`, `apps/web/types`, `packages/database`).
- Exécuter le lint/validation OpenAPI (`npm run openapi:lint`, `spectral lint openapi.yaml` si dispo) et faire tourner les tests API impactés.

### Modification composants UI ou props

- Actualiser les stories Storybook (`*.stories.tsx`) pour couvrir les nouveaux états (default/loading/error/disabled/etc.).
- Régénérer les tests visuels (Storybook test runner / Playwright snapshots / Chromatic selon outillage) et accepter explicitement les diffs attendus.
- Vérifier la cohérence des types côté front (`apps/web/components`, `apps/web/types`) et mettre à jour la doc utilisateur si nécessaire.

### Check PR obligatoire

- Inclure dans la description la checklist Contrats/UI (OpenAPI à jour, stories/tests visuels à jour) avant demande de review.
- Inclure la checklist **DoD Sécurité** si une zone sensible est touchée.

---

## 🎨 Règles UI BlobConnect (user-facing)

- **Design system** : Tailwind + Shadcn, composants dans `apps/web/components/ui/*`. Pas de `<div>` ou `<button>` custom pour recréer ces patterns.
  - ⚠️ **Pas de package `packages/ui` pour le MVP** : tous les composants restent dans `apps/web/components/ui/*` tant qu'il n'y a pas de deuxième frontend (admin séparé, mobile app).
- **Formulaires** : suivre les patterns existants (`apps/web/components/AuthForm.tsx`, `apps/web/components/reservations/*`).
  - **Pattern standard** : validation côté API via DTO Zod → gestion d'état locale React (useState) → appels via `apps/web/lib/apiClient.ts` → affichage erreurs UX.
  - **Pas de librairie de formulaires** pour le MVP (react-hook-form, formik).
- **Icônes & illustrations** : utiliser `lucide-react` exclusivement, variantes accessibles (aria-label, title).
- **Accessibilité** : focus visible, labels explicites, navigation clavier complète, sémantique respectée (role/aria). Tester via Storybook + axe.
- **Design tokens** : ne jamais hardcoder les couleurs/espaces ; puiser dans `tailwind.config.ts` et les variables CSS globales.
- **Stories & visual tests** : tout nouveau state/prop doit avoir sa story (`*.stories.tsx`) et être couvert par `npm run storybook:test`.

---

## 🔐 IA Security Contracts (raccourci opérationnel)

- Refuser toute proposition qui stocke une donnée personnelle sans consentement explicite ou hors finalité documentée.
- Alerter si un cookie, tracking ou publicité est introduit avant consentement CMP ou sans option d’opt-out.
- Pas de champs liés au paiement ou au marketing agressif tant que le produit n’a pas validé l’usage et que la doc RGPD n’est pas mise à jour.
- Vérifier systématiquement : secrets en `.env`, logs via `secureLogger`, aucun token/password/PII en logs.
- Aucun `console.*` en production, aucune dépendance propriétaire sans justification écrite et validation légale.
- Escalader immédiatement si une demande contredit **🔒 Règles de Sécurité CRITIQUES**.

---

## 📋 Changements récents importants

### Push Notifications PWA - Phase 1 (Sept 2025)

**Décision architecture** : Implémentation complète des notifications push avec hébergeur backend (Clever Cloud ou autre) + Firebase.

**Fonctionnalités ajoutées :**
- ✅ Service Worker (`/public/sw.js`)
- ✅ PWA Manifest (`/public/manifest.json`)
- ✅ Firebase Cloud Messaging
- ✅ API routes push (`/api/push/subscribe`, `/api/push/test`, `/api/push/status`)
- ✅ Hook React `apps/web/hooks/usePushNotifications.ts`
- ✅ Composants UI pour prompts permissions
- ✅ Notifications automatiques acceptation/refus demandes
- ✅ Analytics et gestion d'erreurs robuste

**Architecture choisie :**
```
[Frontend PWA] ←→ [Backend API (hébergeur)] ←→ [Firebase FCM] → [Users]
```

**Pourquoi hébergeur backend + Firebase :**
- Clever Cloud (option) : Hébergement API/DB français et simple
- Firebase FCM : Service push gratuit et universel
- Combinaison économique et robuste pour startup

**Variables d'environnement requises :**
```bash
# Backend (API)
FIREBASE_PROJECT_ID=blobinfini-prod
FIREBASE_CLIENT_EMAIL=firebase-admin@...
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----..."

# Frontend (publiques)
NEXT_PUBLIC_FIREBASE_API_KEY=your-web-api-key
NEXT_PUBLIC_FIREBASE_PROJECT_ID=blobinfini-prod
```

**Intégration automatique :**
- Push notifications envoyées lors acceptation/refus de demandes dans `apps/api/src/modules/booking/booking.service.ts`.
- Gestion intelligente des permissions et état d'abonnement.
- Support offline avec cache et retry automatique.

### Suppression du champ `partnerPref` (Sept 2025)

**Décision produit** : Simplification du matching en supprimant le critère de préférence de partenaire.

**Changements appliqués :**
- ❌ Supprimé le champ `partnerPref` du modèle `RiderProfile`.
- ❌ Supprimé le champ `partner` du modèle `LastSearch`.
- ❌ Supprimé complètement l'enum `PartnerPref`.
- ✅ Conservé le champ `sex` pour identifier le sexe de l'individu.
- 🔄 Mis à jour controllers, tests et seed.

Voir `packages/database/prisma/schema.prisma` et `docs/changelog.md` pour les détails historiques.

### Affichage de la date sélectionnée (Sept 2025)

**Décision produit** : Afficher la date sélectionnée dans les cartes de profils sans l'utiliser dans l'algorithme de matching.

**Changements appliqués :**
- ✅ Ajout de la fonction `formatDateForDisplay()` dans `apps/web/app/matching/cards/page.tsx`.
- ✅ Affichage de la date avec icône 📅 dans chaque carte de profil.
- ✅ Formatage intelligent : "Aujourd'hui", "Demain", "Peu importe", ou date formatée.

**Comportement :**
- La date sélectionnée est visible dans chaque carte de profil.
- La date n'influence PAS l'algorithme de recherche (uniquement affichage).
- Permet aux utilisateurs de se rappeler de leur sélection lors du swipe.

### 2025-11-09 — Normalisation du nettoyage Jest & isolation des suites e2e

1. **Résumé pédagogique** – Toutes les suites end-to-end (`auth`, `conversations`, `matching`, `profile`, `admin`, `contact`, `anti-overbooking`, `booking`) reconstruisent désormais leurs fixtures dans un `beforeEach()`. Chaque test repart donc d’un état neuf et n’hérite plus des mutations du test précédent.
2. **Description technique** – Le nettoyage Jest central (`apps/api/jest.setup.db.ts`) repasse systématiquement sur toutes les tables entre les suites, sans exceptions restantes dans `skipCleanupPatterns`. Cette uniformisation stabilise la CI et prépare la bascule vers Prisma 7, où les différences de schema seront immédiatement détectées.

> 🧠 Coach pédago : imagine une gare où chaque train (suite e2e) dispose d’un mini-atelier de remise à zéro avant le départ, pendant que la grande équipe de nettoyage repasse entre chaque passage.
> 🧭 Prochaine étape : surveiller les futures suites e2e et documenter toute nouvelle exception afin de préserver cette isolation totale.

---

## 🏗️ Architecture Technique

### Stack Principal
```
Frontend:  Next.js 14 (App Router) • TypeScript • Tailwind CSS • Shadcn/ui • PWA
Backend:   Node.js • Express • Prisma ORM • PostgreSQL + PostGIS
Temps réel: Socket.IO • Redis (cache + pub/sub)
Auth:      JWT + Refresh tokens • bcrypt • 2FA (TOTP)
Publicité: Google Adsense • Consentement RGPD strict
Infra:     Docker Compose (dev) • Clever Cloud (prod) 🇫🇷 ou autre hébergeur
```

### Structure Monorepo - MVP
```
blobevolutionClaudeCodex/
├── apps/
│   ├── web/                  # Next.js PWA (port 3002 en dev)
│   └── api/                  # API Express modulaire (port 4000)
│       └── src/
│           └── modules/
│               ├── admin/       # Gouvernance & modération
│               ├── analytics/   # Analytics
│               ├── auth/        # 🔐 Authentification
│               ├── blobosphere/ # Contenus éditoriaux
│               ├── booking/     # Réservations & mise en relation
│               ├── chat/        # Messagerie temps réel
│               ├── consent/     # Consentement & publicité
│               ├── contact/     # Contact & support
│               ├── matching/    # Algorithme matching
│               ├── pro/         # Profils pros
│               ├── profile/     # Profils riders
│               ├── push/        # Notifications push
│               ├── reports/     # Signalements
│               └── security/    # Sécurité & audits
├── packages/
│   └── database/            # Prisma schemas + client
├── types/                   # Types partagés (actuel)
├── docker-compose.yml       # PostgreSQL + Redis + services
├── .env.example             # Variables requises
└── turbo.json               # Config Turborepo
```

---

## 🔐 Module Authentification

### Structure
```
modules/auth/
├── auth.controller.ts
├── auth.service.ts
├── auth.guard.ts
├── strategies/
│   ├── jwt.strategy.ts
│   └── local.strategy.ts
└── dto/
    ├── register.dto.ts
    └── login.dto.ts
```

### Routes Auth

- `POST /auth/register` - Inscription + email verification
- `POST /auth/login` - Connexion → JWT + refresh token
- `POST /auth/refresh` - Renouvellement access token
- `POST /auth/logout` - Déconnexion + invalidation
- `POST /auth/2fa/setup` - Configuration 2FA (pros)
- `POST /auth/2fa/verify` - Validation code 2FA
- `POST /auth/forgot-password` - Demande reset
- `POST /auth/reset-password` - Reset avec token

> ℹ️ Les comptes `ADMIN` sont provisionnés manuellement : l’API d’inscription n’accepte plus ce rôle et l’UI publique ne l’expose pas.

---

## 🔒 Règles de Sécurité CRITIQUES

### RGPD & Données

- ✅ Chiffrer TOUTES les données personnelles sensibles (au minimum tokens/refresh, secrets, PII critique).
- ✅ Implémenter droit à l'oubli (soft delete + purge 30j).
- ✅ Logs anonymisés + rotation (ne jamais logguer tokens/password/PII inutile).
- ✅ Consentement explicite pour géolocalisation + cookies/traceurs + publicité.
- ✅ Minimisation : collecter le strict nécessaire.

### Sécurité Code

- ✅ Validation Zod sur TOUS les inputs (API).
- ✅ Requêtes via Prisma (jamais raw).
- ✅ Rate limiting routes sensibles + anti-abus.
- ✅ CSRF tokens sur mutations si cookies.
- ✅ Headers sécurité (CSP, HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy).
- ✅ JWT access token court (ex 15min) + refresh token long (ex 30j) + rotation si possible.
- ✅ 2FA obligatoire pour pros.
- ✅ Contrôle d’accès serveur “deny by default” (RBAC/ABAC).

### Publicité & Consentement RGPD

**Règles strictes pour la publicité** :
- Opt-out possible pour les utilisateurs.
- Consentement explicite pour la personnalisation.
- Liste des providers publicitaires conservée et traçable.

**Emplacements publicitaires** :
- Sidebar desktop (300x250).
- Entre résultats matching (tous les 10 profils).
- Footer articles Blobosphère.

**JAMAIS** :
- ❌ Cookies pub avant consentement.
- ❌ Publicité intrusive (popup, interstitiel).
- ❌ Saturation de l'UX (max 10% de l'espace).

---

## 🌐 Module Blobosphère

### Mission

- Renforcer la visibilité de BlobConnect (SEO + réseaux sociaux) via un hub éditorial riche.
- Relier les univers Riders et Pros à un espace de contenus utiles/inspirants.
- Permettre aux admins de publier, programmer et modérer les contenus.

### Périmètre MVP

- Pages Next.js :
  - `/blobosphere` (listing thématique, CTA partage)
  - `/blobosphere/[slug]` (article, galerie photo)
  - `/admin/blobosphere` (éditeur WYSIWYG + workflow statut)
- Contenus : articles, galeries, interviews (rich text + media).
- Partage : boutons X/Twitter, Facebook, Instagram (deep link), LinkedIn; métadonnées OG/Twitter cards.
- SEO : ISR/SSG, sitemap dédié, slugs optimisés.

### Backend & données

- Module API `blobosphere/` (services, contrôleurs, DTO, tests) dans l’API Express.
- Modèles Prisma : `BlobospherePost`, `BlobosphereTopic`, `BlobosphereShareStats`.
- Statuts : `DRAFT`, `REVIEW`, `PUBLISHED`, `ARCHIVED`.
- Stockage médias : S3/MinIO via module de stockage (voir `docs/blobosphere.md`), génération de vignettes.

### Gouvernance & analytics

- Rôles : `ADMIN` (publication/modération), `EDITOR` (optionnel futur), utilisateur authentifié (lecture).
- Events : `blobosphere.enter`, `blobosphere.share.click`, `blobosphere.post.publish`.
- KPI : +20 % trafic organique, +10 % inscriptions issues des partages.

### Scalabilité

- Reste dans ce monorepo (Next.js + Express + Prisma). Pas de microservice tant que charge < 10k RPM soutenus.
- Plan d’évolution : CDN agressif + service de lecture read-only si trafic média massif.

---

## 💻 Patterns de Code

- Copier les extraits directement depuis le code réel et pointer vers le fichier + lignes.
- Entrées usuelles :
  - DTO Zod : `apps/api/src/modules/*/dto/*.ts`
  - Controllers : `apps/api/src/modules/*/*.controller.ts`
  - Services : `apps/api/src/modules/*/*.service.ts`
  - UI : `apps/web/components/*` et `apps/web/components/ui/*`

---

## 🚨 Points d'attention

- Après changements de schéma : exécuter `npx prisma db push`, puis `npm run build && npm run type-check`.
- Relancer un seed (`npm run db:reseed`) quand les données de référence évoluent.
- Surveiller les serveurs dev (`npm run dev:all`) : consulter les logs Docker en cas d'anomalie.
- Maintenir la cohérence RGPD : consentements enregistrés, minimisation, anonymisation des logs.

---

## 🔄 Workflow type pour modifications

1. Lire le contexte + fichiers voisins (impl/tests/docs).
2. Modifier le schéma Prisma si nécessaire.
3. `npx prisma db push` pour synchroniser la base locale.
4. Mettre à jour controllers/services + DTO + tests liés.
5. Ajouter tests (inclure tests anti-faux-positifs pour heuristiques).
6. Exécuter et reporter : `npm run test && npm run type-check && npm run build`.
7. Mettre à jour docs (snippets copiés du code réel, pas réécrits).

---

## 🐛 Debug & Monitoring

```bash
docker logs -f blobinfini-api
docker logs -f blobinfini-postgres
npm run db:studio
npm run analyze
npm test -- --watch auth.test.ts
```

---

## 📝 Conventions

### Git

- Commits: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`
- Branches: `feature/nom`, `fix/nom`, `hotfix/nom`
- PR obligatoire + review avant merge

### Code

- TypeScript strict mode
- Pas de `any` → `unknown` + type guards (exception cadrée `EXCEPTION_ANY`)
- **Tests & couverture** :
  - **API** : objectif 80% coverage (`npm run test` via Jest)
  - **Frontend** : objectif 70% coverage progressive (Storybook + snapshots visuels prioritaires)
  - **E2E** : parcours critiques via Playwright (`npm run test:e2e`)
- Commentaires en français OK
- Noms variables/fonctions en anglais

### Base de données

- Migrations versionnées
- Seed data pour dev
- Backup quotidien prod (chiffré) + test de restauration
- Index sur géoloc + dates

---

## ⚡ Optimisations Performance

- Images : WebP + lazy loading + CDN
- Cache : Redis 24h pour listes pros/spots
- DB : Index composites sur requêtes fréquentes
- API : Pagination cursor-based (pas offset)
- React : Memo sur composants lourds
- Auth : JWT court (15min) + refresh long (30j)

---

## 🔗 Ressources Clés

### Sécurité Web (priorité absolue)

- OWASP Top 10 (Web)
- OWASP ASVS (Niveau 1/2/3)
- OWASP Cheat Sheet Series (JWT, Session, CORS, CSP, Password Storage…)
- OWASP API Security Top 10
- Mozilla Web Security Guidelines (CSP, cookies, TLS, headers)
- SLSA + dependency hygiene (lockfiles, scanning, pinning)
- Scans : `npm audit` + Dependabot/Renovate si activés

### Performance / DB / scalabilité

- Postgres : index, EXPLAIN, VACUUM/ANALYZE, transactions, verrous
- Prisma : index, pagination, N+1, batching
- Observabilité : logs structurés + metrics + traces (OpenTelemetry) + Sentry

### RGPD & Sécurité 🇫🇷

- CNIL - Guide RGPD du développeur : https://www.cnil.fr/fr/guide-rgpd-du-developpeur
- CNIL - Cookies et traceurs : https://www.cnil.fr/fr/cookies-et-autres-traceurs
- OWASP Top 10 : https://owasp.org/www-project-top-ten/
- ANSSI - Bonnes pratiques : https://www.ssi.gouv.fr/

### Association loi 1901

- Service-Public : https://www.service-public.fr/associations/vosdroits/F1119
- Associations.gouv.fr : https://www.associations.gouv.fr/
- Légifrance - Loi 1901 : https://www.legifrance.gouv.fr/loda/id/JORFTEXT000000497458/

---

## 📚 Documentation Annexe Détaillée

Pour des guides approfondis, consultez le dossier `/docs` :

- Modèle économique : `docs/business-model.md`
- Configuration MCP : `docs/mcp-config.md`
- Blobosphère : `docs/blobosphere.md`
- Changelog : `docs/changelog.md`
- Migration Prisma 6 : `docs/migration-prisma6.md`
- CI/E2E : `docs/ci-e2e.md`
- Storybook : `docs/storybook.md`

---

## 🤖 Configuration MCP pour les IA

### Serveurs MCP Disponibles

Le projet utilise Model Context Protocol (MCP) pour enrichir les capacités des IA.

📖 Voir `docs/mcp-config.md` pour la configuration détaillée.

#### 1) Claude Code (CLI) - `~/.config/claude-code/mcp.json`

```json
{
  "mcpServers": {
    "vercel": {
      "command": "npx",
      "args": ["-y", "vercel-mcp"],
      "env": {
        "VERCEL_API_KEY": "votre-clé-api"
      }
    },
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "votre-token-github"
      }
    }
  }
}
```

Utilisation :

- Vercel MCP : déploiements frontend (logs, domaines, projets)
- Chrome DevTools MCP : debugging, perf, screenshots
- GitHub MCP : recherche/écriture issues, PRs, historique

#### 2) Claude Desktop (App) - `~/.config/claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "sentry": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sentry"],
      "env": {
        "SENTRY_AUTH_TOKEN": "token",
        "SENTRY_ORG": "vigier"
      }
    },
    "playwright": {
      "command": "npx",
      "args": ["-y", "@executeautomation/playwright-mcp-server"]
    },
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-puppeteer"]
    },
    "context7": {
      "command": "npx",
      "args": ["-y", "@context7/mcp-server"],
      "env": {
        "CONTEXT7_API_KEY": "clé"
      }
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "token"
      }
    }
  }
}
```

Utilisation :

- Sentry : analyse erreurs prod
- Playwright : génération/exec tests E2E
- Puppeteer/DevTools : navigation + inspection DOM
- Context7 : recherche doc technique
- GitHub : issues/PRs/historique

### Configuration des Tokens

Voir `docs/mcp-setup.md` pour obtenir les tokens.

### Utilisation MCP dans vos tâches

Les IA peuvent :

- analyser Sentry
- générer tests Playwright
- rechercher de la doc (Context7)
- créer issues GitHub
- gérer déploiements Vercel
- déboguer frontend via DevTools

---

## 🤖 Pour Claude/LLMs (règles d’exécution)

Quand tu génères du code pour BlobConnect / Blobinfini :

1. Reste dans ce repo : ne fais référence qu'au code présent ici.
2. Utilise les MCP : Sentry/GitHub/Playwright/Context7/DevTools quand utile.
3. Sécurité systématique : Zod + RBAC server-side + DoD Sécurité.
4. Zéro `any` (exception cadrée uniquement).
5. RGPD strict : consentements, minimisation, anonymisation.
6. Performance : cache Redis, index DB, éviter N+1.
7. UX mobile : touch-friendly, offline-first (PWA).
8. Publicité éthique : consentement RGPD, opt-out facile, max 10% espace.
9. Tests inclus : au moins 1 test par change sensible + anti-faux-positifs si heuristique.
10. Commandes obligatoires : `npm run test`, `npm run type-check`, `npm run build`.
11. Accessibilité : WCAG 2.1 AA minimum.

### Contexte métier clé

**Modèle économique** :
- Association loi 1901 (gratuit pour tous)
- Revenus : publicité (Google Adsense) + sponsors surf/kite + offres partenaires
- Pas de commission sur transactions
- Pas de paiement intégré (mise en relation uniquement)

**Fonctionnalités** :
- Matching : multi-critères, géoloc PostGIS
- Social : messages temps réel, groupes, favoris
- Auth : JWT court + refresh long, 2FA pros obligatoire
- Sécurité : contrôle identité pro avant session

### Rôles Claude Code

- Impl rapide : `ai/personas/yolo.md` + `ai/prompts/yolo_task.md`
- Débogage/Triage : `ai/personas/debugger.md` + `ai/prompts/debug_request.md`
- Revue PR : `ai/personas/relecteur_pr.md` + `ai/prompts/review.md`
- Tests : `ai/personas/testeur.md` + `ai/prompts/tests.md`
- Performance : `ai/personas/performance.md` + `ai/prompts/perf_request.md`
- Migrations/DB : `ai/personas/migrations_db.md` + `ai/prompts/migration_plan.md`
- Docs/DX : `ai/personas/docs_scribe.md` + `ai/prompts/docs_request.md`

### Utilisation VS Code (Claude Code)

- Créer un profil par rôle et coller le persona dans “System Instructions”.
- Utiliser le template associé pour la demande.
- Voir le protocole : `ai/handbook/claude_code_handshake.md`.

### Boîte aux lettres d’échange

- Dossiers : `ai/exchange/requests/` (demandes) et `ai/exchange/proposals/` (propositions).
- Claude Code dépose des `.diff`/`.md` dans `proposals/`; Codex applique/valide et renvoie feedback.

---

## 👥 Rôles & Profils (Rider/Pro)

### RiderProfile

- Champs clés : `displayName`, `sex`, `lat/lng`, `wantsLesson` (bool), `lessonSport` ('surf'|'kitesurf')
- Matching : préférence cours affichée dans les résultats
- Sécurité : conseils contrôle identité pro avant session

### ProProfile

- Champs clés : `businessName`, `bio`, `photoUrl`, `lat/lng` (lieu de travail)
- Vérification : badge `verified` (bool) après validation admin (SIRET, assurance, diplômes)
- Tarification : affichage tarifs indicatifs (négociation directe rider/pro)

### BloboMap (Pros)

- Front : `/pro/map` (Leaflet + OpenStreetMap). Filtres : sport (surf/kite) + rayon (km).
- API : `GET /pro/near/lessons?sport=surf|kitesurf&radiusKm=25` → riders avec `wantsLesson=true`, `lessonSport=sport`, coords présentes, au moins un match actif, triés par distance.
- Action “Contacter” : `POST /conversations/open` ouvre/crée une conversation directe, puis redirection vers `/messages/{id}`.
- Page `/pro/profile` : renseigner lat/lng + logo (sinon la carte affiche un message invitant à compléter le profil).

### Matching (Rider)

- Page `/matching` : interrupteur "Je veux un cours avec un pro" → `wantsLesson=true` + `lessonSport`
- Résultats : indication "Recherche cours" visible sur les profils
- Sécurité : avertissement contrôle identité pro avant confirmation réservation

### Seeds & Commandes utiles

- `npm run db:seed` → injecte tous les comptes de démo.
- `npm run db:reseed` → efface les données non critiques puis réapplique le seed (rapide).
- `npm run db:reset` → drop + migrate + seed complet.

**Comptes après `npm run db:seed`**
- 20 riders : `dev+rider1@test.com` → `dev+rider20@test.com`
- 5 pros : `dev+pro1@test.com` → `dev+pro5@test.com`
- 1 admin : `dev+admin@test.com`
- Mot de passe commun : `Passw0rd!`
- Profils rapides : Rider surf (`dev+rider@test.com`), Rider kite (`dev+kite@test.com`), Pro (`dev+pro@test.com`)

### Cartographie

- Leaflet + tuiles OpenStreetMap (aucune dépendance payante). Géocodage (Nominatim) possible en extension.
