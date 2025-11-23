# 🏄 Blobinfini – Monorepo IA

## 📋 Mission pour l'IA

Ce monorepo contient la version vivante de Blobinfini, marketplace de mise en relation pour les sports de glisse (surf/kitesurf).

**Votre mission** : Contribuer directement ici. Ignorez l'ancien projet `/blobevolution` (archivé). Pour un rappel historique uniquement, consultez `ai/context/migration_from_blobevolution.md`.

**Référence IA** : Ce README, `AGENTS.md` et `claude.md` sont les guides officiels pour nos IA (Codex, ChatGPT-5, Claude Code) et l’équipe humaine.

**Focus stratégique** : La Blobosphère est l’outil clé pour amplifier la visibilité de Blobinfini via du contenu partageable (SEO + réseaux sociaux).

## 🎯 Vision Produit

Blobinfini connecte les passionnés de sports de glisse en proposant :

- **Matching intelligent** entre riders basé sur géolocalisation, niveau et disponibilités
- **Réservation de cours** avec moniteurs professionnels certifiés
- **Paiements en ligne** (désactivés temporairement le temps de repenser l’intégration Stripe)
- **Messagerie intégrée** avec filtrage anti-contournement
- **Gamification** : Points "Flocons d'avoine", badges, mascotte Blob personnalisable
- **Carte interactive** (BloboMap) montrant groupes et spots en temps réel
- **Blobosphère éditoriale** pour publier articles/photos et renforcer la visibilité de Blobinfini

### Utilisateurs cibles

- **Riders** : Surfeurs/kitesurfeurs 25-45 ans cherchant partenaires ou cours
- **Professionnels** : Moniteurs indépendants et écoles cherchant visibilité
- **Objectif inclusion** : Interface accessible, effort particulier pour attirer les femmes dans ces sports

### ♿ Accessibilité

- **Panneau accessibilité** : un module persistant (`apps/web/components/accessibility`) permet d’activer contraste élevé, police agrandie, police Atkinson Hyperlegible et réduction des animations (stockage local + respect `prefers-reduced-motion`).
- **Navigation clavier** : lien “Aller au contenu principal”, `main#main-content` focusable et annonceur de changement de route `RouteAnnouncer` pour lecteurs d’écran.
- **Contrastes dynamiques** : les thèmes reposent sur les variables CSS Tailwind ; activer le mode contraste élevé force des valeurs RGAA (texte clair, bordures renforcées, focus visibles).
- **Mode clair/sombre** : un bouton persistant en bas à droite permet de basculer à tout moment entre clair et sombre (préférence mémorisée dans le navigateur et initialisée selon `prefers-color-scheme`).

## 🏗️ Architecture Cible

### Stack Technique Requis

```yaml
Frontend:
  - Next.js 14+ (App Router)
  - TypeScript (strict mode)
  - Tailwind CSS + shadcn/ui
  - PWA avec offline-first
  - Framer Motion (animations)

Backend:
  - Node.js + Express
  - Prisma ORM
  - PostgreSQL + PostGIS (géospatial)
  - Redis (cache + pub/sub)
  - Socket.io (temps réel)

Services:
  - Stripe (paiements + 3D Secure — actuellement désactivé)
  - Twilio (SMS/2FA)
  - Google Maps / OpenStreetMap
  - Firebase (notifications push)

Infrastructure:
  - Docker Compose (dev)
  - Vercel (frontend production - gratuit)
  - Clever Cloud ou alternatives gratuites (backend production)
  - Firebase (push notifications)
  - CI/CD GitHub Actions
  - PostGIS activé (image `postgis/postgis:15-3.4` pour dev & CI)
```

### 🆓 Hébergement Backend - Alternatives Gratuites (Phase MVP)

Pour la phase MVP, plusieurs options d'hébergement backend gratuites sont disponibles :

#### Option 1 : **Render** (⭐ Recommandé pour débuter)
- **Gratuit** : 750h/mois de compute (24/7 pour 1 app)
- **Inclus** : PostgreSQL (90 jours gratuit) + Redis (25 MB)
- **Inconvénient** : L'app "s'endort" après 15 min d'inactivité (redémarre en ~30s)
- **Idéal pour** : MVP, démos, prototypes
- **Site** : https://render.com

#### Option 2 : **Railway**
- **Gratuit** : $5 de crédit/mois (~500h de runtime)
- **Inclus** : PostgreSQL + Redis illimités
- **Avantage** : Pas de sleep/hibernation
- **Inconvénient** : Crédit peut s'épuiser avant fin du mois si fort trafic
- **Site** : https://railway.app

#### Option 3 : **Fly.io**
- **Gratuit** : 3 VM + PostgreSQL (3GB)
- **Avantage** : Pas de sleep, bonnes performances
- **Inconvénient** : Configuration plus technique (Dockerfile requis)
- **Site** : https://fly.io

#### Option 4 : **Clever Cloud** (Payant)
- **Payant** : À partir de ~7€/mois
- **Avantages** : Hébergement France (RGPD), support Docker natif, pas de limitations
- **Idéal pour** : Production avec budget
- **Site** : https://www.clever-cloud.com

**Note** : Pour le frontend Next.js, Vercel reste gratuit et illimité (voir section déploiement ci-dessous).

### Structure Monorepo - Phase MVP (Recommandé pour démarrer)

```
blobevolutionClaudeCodex/
├── apps/
│   ├── web/                    # Next.js PWA
│   │   ├── app/               # App Router pages
│   │   ├── components/        # Composants React
│   │   └── lib/               # Hooks, utils
│   └── api/                    # API Express monolithique modulaire
│       ├── src/
│       │   ├── modules/
│       │   │   ├── auth/       # 🔐 Module authentification
│       │   │   │   ├── auth.controller.ts
│       │   │   │   ├── auth.service.ts
│       │   │   │   ├── auth.guard.ts
│       │   │   │   ├── strategies/
│       │   │   │   └── dto/
│       │   │   ├── users/      # Gestion profils
│       │   │   ├── matching/   # Algorithme matching
│       │   │   ├── bookings/   # Réservations
│       │   │   ├── payments/   # Intégration Stripe (mise en pause)
│       │   │   ├── messaging/  # Chat Socket.io
│       │   │   └── blobosphere/ # Contenus éditoriaux & partage social
│       │   ├── middleware/     # Rate limit, CORS, etc.
│       │   └── lib/           # Redis, Prisma, etc.
│       └── Dockerfile
├── packages/
│   ├── database/               # Prisma schemas + client
│   ├── shared/                 # Types TypeScript partagés
│   ├── ui/                     # Composants réutilisables
│   └── utils/                  # Helpers communs
├── docker-compose.yml
├── turbo.json                  # Turborepo config
└── claude.md                   # Guide IA
```

### Structure Services Découplés - Phase Scale (Évolution future)

```
blobevolutionClaudeCodex/
├── services/                   # Microservices (après 1000+ users)
│   ├── auth-service/          # Service auth dédié
│   ├── matching-service/      # Service matching dédié
│   ├── payment-service/       # Service paiements dédié
│   └── messaging-service/     # Service chat dédié
```

## 🔐 Architecture Authentification

### Phase MVP - Module Auth Intégré

L'authentification est un **module dans l'API principale** pour simplifier le développement :

```typescript
// apps/api/src/modules/auth/
├── auth.controller.ts    # Routes: login, register, refresh, 2fa
├── auth.service.ts        # Logique: JWT, bcrypt, sessions
├── auth.guard.ts          # Middleware protection routes
├── strategies/
│   ├── jwt.strategy.ts    # Validation JWT
│   └── local.strategy.ts  # Email/password
└── dto/
    ├── register.dto.ts    # Validation inscription
    └── login.dto.ts       # Validation connexion
```

### Fonctionnalités Auth (État Actuel)

- ✅ **Registration avec vérification email** (implémenté)
- ✅ **Login JWT + Refresh tokens** (implémenté)
- ✅ **Reset password sécurisé** (implémenté)
- ✅ **Sessions multi-devices** (implémenté)
- ✅ **Logout avec invalidation tokens** (implémenté)
- ✅ **RGPD: consentement, export, suppression** (implémenté)
- ✅ **2FA obligatoire pour pros** (implémenté - activation via email + code 2FA)
- ⏳ **Social login** (Google, Facebook) (Phase 2)

### Schéma Base de Données

```prisma
model User {
  id               String    @id @default(uuid())
  email            String    @unique
  password         String    // Hashé bcrypt
  role             Role      @default(RIDER)
  emailVerified    Boolean   @default(false)
  twoFactorEnabled Boolean   @default(false)

  // RGPD
  consentedAt      DateTime?
  deletedAt        DateTime? // Soft delete

  // Relations
  sessions         Session[]
  riderProfile     RiderProfile?
  proProfile       ProProfile?
}
```

## 🔒 Sécurité - État Actuel

### ✅ RGPD Complète (Implémenté)

- ✅ **Chiffrement AES-256** données personnelles
- ✅ **Consentement explicite** géolocalisation
- ✅ **Minimisation** : aucune donnée de paiement collectée (parcours sans transaction intégrée)
- ✅ **Droit à l'oubli** (soft delete + purge automatique 3 phases)
- ✅ **Export données utilisateur** (GDPR CLI intégré)
- ✅ **Logs anonymisés** après 30 jours
- ✅ **Hébergement données en Europe** (Clever Cloud France)

### ✅ Sécurité Technique (Implémenté)

- ✅ **Validation Zod** sur TOUS les inputs API
- ✅ **Prisma ORM** exclusif (pas de SQL raw)
- ✅ **Rate limiting intelligent** (170+ endpoints protégés)
- ✅ **CSRF tokens** obligatoires sur toutes mutations
- ✅ **Headers sécurité** (CSP, HSTS, XSS Protection)
- ✅ **JWT + refresh tokens** sécurisés (rotation automatique)
- ✅ **2FA obligatoire pour pros** (déployé)

### Décision: Refresh tokens (MVP)

- Stockage: empreinte SHA‑256 du refresh token (non réversible) au lieu d’un hash salé type bcrypt pour permettre une comparaison déterministe et rapide.
- Rotation: lors de l’appel à `/auth/refresh`, tous les refresh tokens actifs de l’utilisateur sont révoqués puis un nouveau token est émis. Cela impose la sémantique « single‑use » et évite toute réutilisation accidentelle d’un ancien token.
- Tests: des tests E2E vérifient l’inscription, la connexion, la rotation du refresh (l’ancien devient invalide), le logout (global et device unique), et le reset password.
- Implémentation: voir `apps/api/src/modules/auth/auth.service.ts`.

### Protection Commission

- ✅ Filtrage emails/téléphones dans messages
- ✅ QR codes uniques par session
- ✅ Détection comportements suspects
- ✅ Rappel avantages plateforme

### Rate limiting & `/auth/me`

- **Comportement actuel** : toutes les routes `POST /auth/*` (login, refresh, etc.) restent protégées par le profil strict `AUTH` (5 requêtes / 15 min). Les routes `GET /auth/*` — notamment `GET /auth/me` appelé après connexion — sont volontairement routées vers le profil `API_STANDARD` (100 requêtes / 15 min) pour éviter les 429 en développement où les re-rendus se multiplient.
- **Checklist passage en prod** :
  1. **Mesurer le trafic réel** (`/auth/me` est instrumenté via les logs rate-limit). Si les clients officiels restent en dessous de ~300 requêtes / 15 min par IP, la configuration actuelle suffit.
  2. **Besoin de durcir ?** Créer un profil dédié `AUTH_READ` dans `apps/api/src/middleware/enhanced-rate-limit.ts` (ex: 300 req / 15 min) et router les `GET /auth/*` dessus. Les POST `/auth/*` ne doivent jamais quitter le profil `AUTH`.
  3. **Industrialisation** : exposer les seuils via variables d’environnement (`AUTH_MAX`, `AUTH_READ_MAX`, etc.) pour permettre un ajustement sans redeploiement.
  4. **Côté front** : garder une déduplication/caching (`optimizedApiClient.me()`, SWR…) afin d’éviter les rafales client. Lors d’une intégration tierce, imposer une limite max de 1 appel `/auth/me` par cycle de rendu.
  5. **Observabilité** : en production, monitorer les occurrences de `AUTH_RATE_LIMIT_EXCEEDED` et déclencher une alerte si elles réapparaissent une fois les seuils calibrés.

## 📊 Fonctionnalités par Phase

### ✅ Phase 1 - MVP (Complétée en grande partie)

- ✅ **Auth Module complet** : inscription, connexion, JWT, reset password, RGPD
- ✅ **Matching & Géolocalisation** : algorithme intelligent PostGIS
- ✅ **Réservations basiques** : demandes riders ↔ pros
- ✅ **Chat temps réel** : Socket.io avec anti-contournement
- ✅ **PWA avancée** : push notifications, offline-first, installation
- ✅ **Performance optimisée** : cache Redis, requêtes N+1 éliminées
- ✅ **Sécurité production** : CSRF, rate limiting, RGPD complet
- ⏸️ **Système paiement** : Stripe Connect (intégration suspendue)
- ⏳ **Blobosphère MVP** : CMS éditorial (en cours)


### 🚀 Phase 2 - Croissance (Prochaines priorités)

- 🔥 **Système paiement complet** : Stripe Connect + facturation automatique (replanifié)
- 🔥 **Tests unitaires** : couverture 80%+ pour stabilité production
- 📈 **Blobosphère enrichie** : CMS complet + SEO + partage social
- 📊 **Analytics avancées** : tableau de bord business + métriques
- 🎯 **Social login** (Google, Facebook) pour conversion
- 🤖 **Matching ML** multi-critères intelligent
- 🏆 **Système réputation** (notes/avis post-session)

### Phase 3 - Scale (12 mois)

- [ ] **Migration auth vers service dédié**
- [ ] Multi-sports (windsurf, paddle)
- [ ] API publique REST/GraphQL
- [ ] Chatbot IA (Blobot)
- [ ] Camps/stages réservables
- [ ] Marketplace équipement
- [ ] Internationalisation

## 🤖 Configuration MCP (Model Context Protocol)

### Serveurs MCP Disponibles

Le projet **blobevolutionClaudeCodex** est configuré pour utiliser plusieurs serveurs MCP qui enrichissent les capacités des IA :

#### Pour Claude Code (CLI)
Configuration : `~/.config/claude-code/mcp.json`

```json
{
  "mcpServers": {
    "vercel": {
      "command": "npx",
      "args": ["-y", "vercel-mcp"],
      "env": {
        "VERCEL_API_KEY": "votre-clé-api-vercel"
      }
    },
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest"]
    }
  }
}
```

**Capacités** :
- **Vercel MCP** : Gestion des déploiements, projets, domaines, logs Vercel
- **Chrome DevTools MCP** : Automatisation navigateur, debugging, screenshots, analyse de performance

#### Pour Claude Desktop (Application)
Configuration : `~/.config/claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "sentry": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sentry"],
      "env": {
        "SENTRY_AUTH_TOKEN": "votre-token-sentry",
        "SENTRY_ORG": "votre-organisation"
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
        "CONTEXT7_API_KEY": "votre-clé-context7"
      }
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

**Capacités** :
- **Sentry** : Surveillance erreurs production, analyse stack traces, création de rapports de bugs
- **Playwright** : Tests E2E automatisés, génération de scripts de test
- **Chrome DevTools (Puppeteer)** : Navigation web, inspection DOM, capture de performance
- **Context7** : Recherche de documentation technique, exemples de code
- **GitHub** : Gestion issues/PRs, recherche de code, analyse historique

### Configuration des Tokens

Pour activer les serveurs MCP :

1. **Sentry** : https://sentry.io/settings/account/api/auth-tokens/
2. **Context7** : https://context7.com (compte + clé API)
3. **GitHub** : https://github.com/settings/tokens (scopes: `repo`, `read:org`, `workflow`)
4. **Vercel** : https://vercel.com/account/tokens

### Documentation Complète

Voir `docs/mcp-setup.md` pour :
- Installation détaillée
- Obtention des tokens
- Utilisation par les IA
- Dépannage

## 🚀 Instructions pour l'IA

### Lignes directrices

- Travaillez exclusivement dans `blobevolutionClaudeCodex`.
- Respectez l'architecture modulaire (auth, matching, bookings, payments, messaging).
- Intégrez le module `blobosphere` (contenus éditoriaux) pour renforcer la visibilité externe.
- Utilisez les serveurs MCP disponibles (Sentry, GitHub, Playwright, Chrome DevTools, Context7, Vercel) pour enrichir vos capacités d'analyse et de déploiement.
- Sécurité systématique : Zod sur tous les inputs, Prisma uniquement, rate limiting, CSRF, headers de sécurité.
- Auth : JWT 15 min + refresh 30 j, 2FA obligatoire pour les pros, sessions invalidables.
- RGPD : consentement explicite, anonymisation, droit à l'oubli, export des données.
- Performance : PostGIS, Redis, index composites, pagination cursor-based.
- Qualité : TypeScript strict, tests unitaires/E2E, couverture ≥ 80 %.
- CI/CD : utilisez les scripts fournis (`npm run build`, `npm test`, etc.) et surveillez la GitHub Action `CI`.

### Processus recommandé

1. Lisez `claude.md` et ce README avant chaque session.
2. Clarifiez le périmètre (feature/bug) et proposez un plan de travail court.
3. Priorisez les modules critiques (auth par défaut) si la priorité n’est pas spécifiée.
4. Livrez par petits commits/diffs, avec migrations et seeds synchronisés.
5. Vérifiez les impacts Blobosphère (SEO, partage, rôles admin) si votre changement touche l’éditorial.
6. Ajoutez/actualisez tests, seeds, SEO metadata et documentation.
7. Exécutez `npm run lint`, `npm run type-check` et `npm test` avant de soumettre.

## 💻 Commandes de Développement

```bash
# Installation rapide
git clone https://github.com/vigierAudrey/blobevolutionClaudeCodex.git
cd blobevolutionClaudeCodex
npm install

# Setup environnement (première fois uniquement)
cp .env.example .env
docker compose up -d postgres redis minio mailpit
npm run db:reseed  # Base + données de test

# Développement
npm run dev:all      # Lance API (port 4000) + Frontend (port 3002)
npm run dev:api      # API seulement
npm run dev:web      # Frontend seulement

# Base de données
npm run db:migrate   # Applique les migrations
npm run db:seed      # Charge les données de test
npm run db:reset     # Reset complet (drop + migrate + seed)
npm run db:studio    # Interface admin Prisma

# Build et tests
npm run build        # Build de production (API uniquement)
npm run type-check   # Vérification TypeScript
```

## 🌐 Déploiement Frontend avec Vercel

### Configuration Initiale

Le frontend Next.js (`apps/web`) est déployé sur **Vercel**, tandis que le backend NestJS (`apps/api`) reste hébergé sur **Clever Cloud**.

#### 1. Installation du CLI Vercel

```bash
npm i -g vercel
```

#### 2. Connexion à Vercel

```bash
vercel login
```

Suivez les instructions pour vous authentifier (GitHub, GitLab, Bitbucket ou Email).

#### 3. Configuration du Projet

```bash
cd apps/web
vercel link
```

Lors de la première exécution, Vercel vous demandera :
- **Set up and deploy?** → Oui
- **Which scope?** → Sélectionnez votre compte/équipe
- **Link to existing project?** → Non (première fois) puis créez un nouveau projet
- **Project name** → `blobinfini` (ou nom de votre choix)
- **In which directory is your code located?** → `./` (déjà dans apps/web)

#### 4. Configuration des Variables d'Environnement

Ajoutez ces variables dans le tableau de bord Vercel (Settings → Environment Variables) :

```bash
# OBLIGATOIRE
NEXT_PUBLIC_API_URL=https://votre-api.cleverapps.io
NEXT_PUBLIC_SITE_URL=https://blobinfini.vercel.app

# OPTIONNEL - Push Notifications (Firebase)
NEXT_PUBLIC_FIREBASE_API_KEY=votre-clé-firebase
NEXT_PUBLIC_FIREBASE_PROJECT_ID=votre-projet-id
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=votre-sender-id
NEXT_PUBLIC_FIREBASE_APP_ID=votre-app-id

# OPTIONNEL - Analytics
NEXT_PUBLIC_ADSENSE_CLIENT_ID=ca-pub-XXXXXXXXXX
NEXT_PUBLIC_ADSENSE_ENABLED=true
```

**Astuce** : Copiez les valeurs depuis `apps/web/.env.example` et adaptez-les pour la production.

#### 5. Déploiement

##### Déploiement Automatique (Recommandé)

Une fois le projet lié, **chaque push sur `main` ou `develop`** déclenche automatiquement un déploiement Vercel.

##### Déploiement Manuel

```bash
cd apps/web
vercel --prod
```

#### 6. URLs de Déploiement

Après chaque déploiement, Vercel génère :
- **URL de production** : `https://blobinfini.vercel.app` (ou votre domaine custom)
- **URLs de prévisualisation** : Une URL unique par commit/branche (ex: `https://blobinfini-git-feat-xxx.vercel.app`)

Vous pouvez consulter tous les déploiements sur : `https://vercel.com/dashboard`

### ⚠️ CI/CD et Vercel

**Important** : Les builds frontend sont désormais gérés par **Vercel**, pas par GitHub Actions.

- ✅ **GitHub Actions** : Lint, type-check, tests unitaires et E2E (frontend + backend)
- ✅ **Vercel** : Build et déploiement du frontend Next.js uniquement
- ✅ **Clever Cloud** : Déploiement du backend NestJS (via Docker)

Le workflow `.github/workflows/ci.yml` a été adapté pour :
- **Supprimer** l'étape `Build web app` (gérée par Vercel)
- **Conserver** les étapes de validation (lint, type-check, tests)
- **Préserver** la compatibilité avec `act` pour les tests locaux

### 🔧 Tests Locaux avec `act`

Pour tester les workflows GitHub Actions en local avec `act` :

```bash
# Installer act (si pas déjà fait)
brew install act  # macOS
# ou
curl https://raw.githubusercontent.com/nektos/act/master/install.sh | sudo bash  # Linux

# Exécuter les workflows localement
act -j build-and-test
```

Les étapes de déploiement Vercel sont automatiquement ignorées dans les runs locaux.

### 2025-11-09 — Politique de nettoyage Jest (2025)

1. **Résumé** – Toutes les suites e2e critiques (`auth`, `conversations`, `matching`, `profile`, `admin`, `contact`, `anti-overbooking`, `booking`) reconstruisent leurs fixtures dans un `beforeEach()`. Chaque scénario repart ainsi d’un environnement neuf, sans dépendre des créations effectuées par un test précédent.
2. **Description technique** – `apps/api/jest.setup.db.ts` vide désormais l’ensemble des tables entre les suites Jest sans aucune exception dans `skipCleanupPatterns`. Cette politique rend la CI plus prévisible et prépare la migration Prisma 7.

> 🧠 Coach pédago : chaque train (suite e2e) passe désormais par son atelier de remise à zéro avant le départ, pendant que la grande équipe de nettoyage repasse entre chaque passage.  
> 🧭 Prochaine balade naturelle : surveiller l’arrivée de nouvelles suites e2e et documenter immédiatement tout besoin spécifique pour conserver cette isolation totale.

### 📦 Architecture de Déploiement

```
┌─────────────────────────────────────────────────────────┐
│                    GitHub Repository                     │
│                 (blobevolutionClaudeCodex)              │
└────────────┬────────────────────────────┬───────────────┘
             │                             │
     ┌───────▼────────┐          ┌────────▼──────────┐
     │  GitHub Actions │          │      Vercel       │
     │   (CI/CD)       │          │   (Auto Deploy)   │
     │                 │          │                   │
     │ • Lint          │          │ • Build Frontend  │
     │ • Type-check    │          │ • Deploy Next.js  │
     │ • Tests         │          │ • CDN Global      │
     └─────────────────┘          └────────┬──────────┘
                                            │
                                   ┌────────▼──────────┐
                                   │  Production URL   │
                                   │  *.vercel.app     │
                                   └───────────────────┘
                                            │
                                            │ API Calls
                                            ▼
                                   ┌───────────────────┐
                                   │  Clever Cloud     │
                                   │  (Backend API)    │
                                   │  + PostgreSQL     │
                                   │  + Redis          │
                                   └───────────────────┘
```

### 🚀 Workflow de Développement

1. **Développement local** :
   - Chemin A (API hors Docker): `npm run dev:all`
   - Chemin B recommandé (API dans Docker): `npm run dev:all:docker`
     - Démarre l'infra Docker (Postgres, Redis, MinIO, Mailpit) et l'API dans Docker
     - Lance le frontend Next.js en local sur `http://localhost:3002`
2. **Créer une branche** : `git checkout -b feat/nouvelle-fonctionnalite`
3. **Commit et push** : `git push origin feat/nouvelle-fonctionnalite`
4. **Vercel crée automatiquement** une URL de prévisualisation
5. **GitHub Actions** vérifie lint/tests/type-check
6. **Merge vers `main`** → Déploiement automatique en production sur Vercel

### 🎯 Bonnes Pratiques

- ✅ Testez toujours localement avant de push (`npm run dev:web`)
- ✅ Vérifiez les logs de build Vercel en cas d'erreur (dashboard Vercel)
- ✅ Utilisez les URLs de prévisualisation pour tester avant merge
- ✅ Configurez un domaine custom dans Vercel (Settings → Domains) si besoin
- ✅ Activez les "Deployment Protection" pour sécuriser la production (Vercel Pro)

### 🔗 Ressources Vercel

- [Documentation Vercel](https://vercel.com/docs)
- [Next.js sur Vercel](https://vercel.com/docs/frameworks/nextjs)
- [Variables d'environnement](https://vercel.com/docs/environment-variables)
- [Domaines personnalisés](https://vercel.com/docs/custom-domains)


## 🔔 Push Notifications - Architecture Hybride

### Décision Technique : Clever Cloud + Firebase

**Choix architectural** : Hébergement API sur Clever Cloud avec Firebase Cloud Messaging pour les notifications push.

#### Pourquoi cette combinaison ?

```yaml
Clever Cloud:
  - Hébergement API Node.js ✅
  - Base de données PostgreSQL ✅
  - Redis pour le cache ✅
  - Déploiement simple et français ✅
  - Pas de service push natif ❌

Firebase FCM:
  - Service push gratuit et illimité ✅
  - Compatible tous navigateurs ✅
  - Infrastructure mondiale Google ✅
  - SDK officiels Android/iOS/Web ✅
  - Aucun serveur à maintenir ✅
```

#### Architecture de communication

```
[Frontend PWA] ←→ [Clever Cloud API] ←→ [Firebase FCM] → [Dispositifs Users]
     ↑                    ↑                   ↑
Service Worker     Firebase Admin SDK   Push Service
   (Client)           (Serveur)        (Google/Apple)
```

#### Configuration requise

**Variables d'environnement Clever Cloud :**
```bash
FIREBASE_PROJECT_ID=blobinfini-prod
FIREBASE_CLIENT_EMAIL=firebase-admin@blobinfini.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."
```

**Frontend (variables publiques) :**
```bash
NEXT_PUBLIC_FIREBASE_API_KEY=your-web-api-key
NEXT_PUBLIC_FIREBASE_PROJECT_ID=blobinfini-prod
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789
```

#### Fonctionnalités implémentées (Phase 1)

- ✅ **Service Worker** sophistiqué avec gestion offline
- ✅ **PWA Manifest** pour installation app-like
- ✅ **Notifications automatiques** acceptation/refus demandes
- ✅ **API Routes** `/push/subscribe`, `/push/test`, `/push/status`
- ✅ **Hooks React** `usePushNotifications` pour intégration
- ✅ **Composants UI** prompts de permissions élégants
- ✅ **Analytics** tracking interactions notifications
- ✅ **Gestion d'erreurs** robuste et fallbacks

#### Coûts

- **Clever Cloud** : ~10-30€/mois (API + DB)
- **Firebase FCM** : Gratuit (jusqu'à millions de notifications)
- **Total** : Très économique pour une startup

#### Alternatives écartées

- **OneSignal** : Payant après 10k users
- **AWS SNS** : Plus complexe, coûts variables
- **Web Push natif** : Complexité serveur énorme
- **Services Clever Cloud tiers** : Aucun disponible

## 📋 Changements récents

### Suppression du champ `partnerPref` (Sept 2025)

**Simplification du matching** : Le champ `partnerPref` (préférence de partenaire) a été supprimé pour simplifier l'algorithme de matching.

- ❌ **Supprimé** : `partnerPref` (RiderProfile), `partner` (LastSearch), enum `PartnerPref`
- ✅ **Conservé** : champ `sex` pour identifier le sexe de l'individu
- 🎯 **Nouveau matching** : géolocalisation + sport + niveau + disponibilités uniquement

### Affichage date sélectionnée dans matching (Sept 2025)

**UX amélioration** : La date sélectionnée par l'utilisateur est maintenant visible dans chaque carte de profil.

- ✅ **Ajouté** : Fonction `formatDateForDisplay()` avec formatage intelligent
- ✅ **Interface** : Icône 📅 + date dans chaque carte ("Aujourd'hui", "Demain", "Peu importe")
- 🎯 **Comportement** : Affichage uniquement, la date n'influence pas l'algorithme de recherche

## 🌐 Blobosphère – Hub éditorial

### Objectif produit
- Amplifier la visibilité de Blobinfini via un espace éditorial riche (articles, interviews, reportages photo).
- Créer un tunnel d’entrée SEO/social : chaque contenu dispose d’URL publiques optimisées et de métadonnées partageables.
- Offrir aux riders/pros un lien direct depuis leurs univers respectifs pour explorer l’actualité de la communauté.

### Parcours utilisateur
- Depuis les sections Riders et Pros, un lien “Explorer la Blobosphère” ouvre `/blobosphere` (nouvelle route Next.js).
- Contenus structurés par thèmes (spots, riders, pros, écologie). Possibilité de filtrer et de rechercher.
- Boutons de partage social (X/Twitter, Facebook, Instagram, LinkedIn) avec prévisualisations OG/Twitter Cards.

### Gestion éditoriale (Admin)
- Les comptes `ADMIN` accèdent à `/admin/blobosphere` (guardé) pour rédiger, prévisualiser et publier.
- Workflow statut : `draft` → `review` → `published` → `archived`.
- Possibilité d’épingler un contenu sur la page d’accueil Blobosphère et dans les univers Riders/Pros.
- Outils de modération : signalements utilisateurs, bannière “contenu signalé”, archivage rapide.

### Architecture & données
- Nouveau module API `blobosphere/` (services, contrôleurs, DTO Prisma).
- Modèles Prisma suggérés :
  ```prisma
  model BlobospherePost {
    id            String   @id @default(uuid())
    slug          String   @unique
    title         String
    excerpt       String
    content       Json
    coverImageUrl String?
    status        BlobosphereStatus @default(DRAFT)
    publishedAt   DateTime?
    authorId      String
    author        User     @relation(fields: [authorId], references: [id])
    topics        BlobospherePostTopic[]
    shareStats    BlobosphereShareStats?
    createdAt     DateTime @default(now())
    updatedAt     DateTime @updatedAt
  }
  ```
- Stockage médias : bucket S3/MinIO (géré par le package `blobinfini/storage`), génération de formats responsive.
- SEO : ISR/SSG par post, réhydratation côté client pour interactions (likes, commentaires futurs).

### Mesure & analytics
- Événements : `blobosphere.enter`, `blobosphere.share.click`, `blobosphere.post.publish`.
- Dashboard Metabase/Looker : trafic, partages, conversions (clic vers inscription).
- Objectif KPI : +20% trafic organique mensuel et +10% inscriptions issues de posts partagés.

### Scalabilité
- Reste dans ce monorepo : Next.js (web), module Express (API), Prisma/Postgres.
- Si trafic média dépasse la charge transactionnelle (pics >10K RPM soutenus) : envisager CDN agressif + microservice lecture read-only (non prioritaire MVP).

## 👥 Rôles, Profils et BloboMap

- Riders et Pros disposent d’un CTA "Explorer la Blobosphère" pour accéder au hub éditorial (route `/blobosphere`).

### Riders (Particuliers)

**Profil & données**

- Profil `RiderProfile` avec `wantsLesson` (bool) et `lessonSport` (surf|kitesurf).
- Matching : bouton "Faire appel à un pro" et interrupteur "Je veux un cours".
- Affichage badge "🎓 Cours" sur cartes/résultats si `wantsLesson=true`.
- Données conservées : préférences sport, niveau, zone géographique, demandes de session, consentements RGPD.

**Parcours MVP**

1. Inscription + vérification email (support rider ou pro).
2. Configuration du profil et consentement géolocalisation.
3. Exploration de `/matching`, envoi d’une demande de session et échanges avec le pro.
4. Validation finale hors plateforme (paiement non géré dans Blobinfini pour le MVP).

### Pros (Professionnels)

**Profil & données**

- Profil `ProProfile` (nom commercial, bio, photo/logo, lieu de travail lat/lng, `verified`).
- Informations tarifaires conservées uniquement en base (non exposées) pour préparer le futur retour du paiement.
- Créneaux publiés, demandes reçues et journal d’audit pro.
- Pièces justificatives partagées hors plateforme : les utilisateurs doivent vérifier directement les documents fournis par le professionnel.
- Auth renforcée avec 2FA obligatoire sur connexion.

**Parcours MVP**

1. Inscription via parcours pro + activation email.
2. Activation du 2FA (code reçu par email) à la première connexion.
3. Paramétrage du profil public et des créneaux sur `/pro/profile` et `/pro/map`.
4. Réception des demandes, réponse (acceptation/refus) et suivi depuis le planning pro.

### API liées

- `PUT /profile/me`: accepte `wantsLesson`, `lessonSport` (rider).
- `GET /pro/near/lessons?sport=surf|kitesurf&radiusKm=25`: demandes de cours visibles par tous les pros du périmètre (variante B), Riders ayant au moins un match actif, tri par distance.
- `POST /conversations/open`: crée/retourne une conversation directe entre 2 users.

### Web

- `/matching` → interrupteur “Je veux un cours” + badge 🎓 en liste.
- `/pro/profile` → lieu de travail (lat/lng), logo; pas de champ prix en UI publique.
- `/pro/map` → Leaflet + OpenStreetMap, filtres sport/rayon, bouton “Contacter”. Le rayon unique est partagé pour le surf **et** le kite et est sauvegardé côté pro.

## 🧪 Données de démo (seed)

- Commandes:
  - `npm run db:seed` → crée des comptes de démo.
  - `npm run db:reseed` → efface les données et réinjecte la démo (rapide, sans toucher au schéma).
  - `npm run db:reset` → drop + remigre + seed (reset complet).

- Démarrage rapide à copier-coller (local) :

  ```bash
  # 1. Préparer l'environnement (la copie .env est nécessaire uniquement la première fois)
  cp -n .env.example .env 2>/dev/null || true
  docker compose up -d postgres redis minio mailpit
  npm install
  npm run db:reseed

  # 2. Lancer les serveurs applicatifs (dans deux terminaux séparés)
# Démarrage dev (Chemin B – API dans Docker)
npm run dev:all:docker

# Démarrages ciblés
npm run dev:infra       # Postgres/Redis/MinIO/Mailpit (Docker)
npm run dev:api:docker  # API dans Docker
npm run dev:web         # Frontend en local (http://localhost:3002)

Notes:
- Pour accéder à Swagger: `http://localhost:4000/api/docs` (API dans Docker)
- Assurez-vous d'avoir `REDIS_PASSWORD` dans votre `.env` pour l'infra Docker
  ```

  - API dispo sur `http://localhost:4000`
  - Front web sur `http://localhost:3002`
  - Mailpit (inbox mails dev) : `http://localhost:8025`
  - Console fichier MinIO (stockage images) : `http://localhost:9001` (`minioadmin` / `minioadmin`)


## 🗺️ Carte (open source, sans Google)

- Front: Leaflet + tuiles OpenStreetMap.
- Pas de dépendance payante Google Maps.
- Extension prévue: géocodage gratuit Nominatim pour convertir adresses → lat/lng.

Activer l’envoi d’emails (dev avec Mailpit)

- Démarrer Mailpit: inclus dans `docker-compose.yml` → `docker compose up -d mailpit` (UI: http://localhost:8025)
- `.env` déjà prêt pour Mailpit: `SMTP_HOST=localhost`, `SMTP_PORT=1025`, `SMTP_SECURE=false`.
- Définir `WEB_BASE_URL` (ex: http://localhost:3001) pour générer les liens.
- `apps/api` dépend de `nodemailer`; exécutez `npm install` à la racine si besoin.

Sans SMTP actif, l’API continue de fonctionner et ignore l’envoi (log d’info seulement).

## 📝 Patterns de Code à Suivre

### Module Auth

```typescript
// apps/api/src/modules/auth/auth.service.ts
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['RIDER', 'PRO']),
});

export class AuthService {
  async register(data: unknown) {
    const validated = registerSchema.parse(data);

    // Hash password
    const hashedPassword = await bcrypt.hash(validated.password, 12);

    // Create user with Prisma
    const user = await prisma.user.create({
      data: {
        email: validated.email,
        password: hashedPassword,
        role: validated.role,
        verifyToken: crypto.randomBytes(32).toString('hex'),
      },
    });

    // Send verification email
    await emailService.sendVerification(user.email, user.verifyToken);

    return { message: 'Check email to verify account' };
  }

  async login(email: string, password: string) {
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      throw new UnauthorizedException();
    }

    // Generate tokens
    const accessToken = jwt.sign({ sub: user.id, role: user.role }, process.env.JWT_SECRET, {
      expiresIn: '15m',
    });

    const refreshToken = jwt.sign({ sub: user.id }, process.env.JWT_REFRESH_SECRET, {
      expiresIn: '30d',
    });

    // Save session
    await this.saveSession(user.id, refreshToken);

    return { accessToken, refreshToken };
  }
}
```

### API Route Protégée

```typescript
// apps/api/src/modules/bookings/bookings.controller.ts
import { requireAuth } from '@/modules/auth/auth.guard';

router.post(
  '/bookings',
  requireAuth, // Vérifie JWT
  requireRole('RIDER'), // Vérifie rôle
  rateLimit(100), // Rate limiting
  async (req, res) => {
    const booking = await bookingService.create(req.user.id, req.body);
    res.json(booking);
  },
);
```

## 🔍 Points d'Attention Spécifiques

### Authentification

- JWT courte durée (15min) + refresh token (30j)
- Stockage refresh tokens en base (révocation possible)
- 2FA obligatoire pour pros (génération QR code TOTP)
- Invalidation sessions lors logout
- Rate limiting sur login (5 tentatives/minute)

### Matching Algorithm

- PostGIS pour requêtes géospatiales
- Redis cache pour performances
- Maximum 4 riders par groupe
- Expiration demandes jour-même
- Système verrouillage groupe (cadenas)

### Paiement & Commission (désactivés)

- Intégration Stripe temporairement coupée
- Aucun prélèvement ni escrow en production
- Réactivation planifiée une fois le nouveau parcours défini

### Messagerie

- Filtrage regex emails/téléphones
- Conversations limitées aux matchs confirmés
- Archivage auto après 30 jours inactivité
- Modération IA contenus inappropriés

### Gamification

- Points "Flocons d'avoine" par action
- Badges débloquables (Top Rider, Pro Elite)
- Mascotte Blob personnalisable (accessoires)
- Événements communautaires (élection Blob)

## 📚 Documentation Technique

- [Synthèse Projet (PDF)](./docs/synthese-blobinfini.pdf)
- [API Documentation](./docs/api.md)
- [Database Schema](./docs/database.md)
- [Security Guidelines](./docs/security.md)
- [RGPD Compliance](./docs/rgpd.md)
- [Publicités & Consentement](./README_ADS.md)
- [Tests E2E & CI](./README_TESTS.md)

## 🤝 Contribution IA

### Checklist avant de coder
1. **Synchronisez le contexte** : relisez `claude.md`, ce README et les RFC pertinentes (`docs/architecture/*`).
2. **Cadrez le besoin** : story/bug, critères d’acceptation, métriques attendues (inclure impacts Blobosphère/SEO/IA).
3. **Mappez les dépendances** : migrations Prisma, seeds, feature flags, variables d’environnement, scripts CI.
4. **Partagez un plan concis** : étapes, fichiers ciblés, tests prévus; validez-le avec l’équipe avant d’écrire du code.
5. **Itérez par petits commits/diffs** : documentez les décisions et actualisez la doc associée (README, claude.md, RFC).
6. **Gardez la visibilité en tête** : pour toute feature touchant la Blobosphère, mettez à jour SEO, métadonnées de partage et analytics (`aiRedirects`).
7. **Exécutez la boucle CI locale** : `npm run lint`, `npm run type-check`, `npm test`, scénarios E2E obligatoires si concernés.

### Definition of Done
- ✅ Couverture de tests ≥ 80 % (unitaires + E2E ciblés).
- ✅ TypeScript strict sans `any` non justifié.
- ✅ Patterns de sécurité respectés (Zod, Prisma, rate limiting, secrets).
- ✅ Documentation actualisée (technique + guides IA) et migrations/seed incluses si besoin.
- ✅ Expérience Blobosphère vérifiée (routing public, partage social, rôle admin, contenu attractif pour IA).

## 📞 Support & Contact

- **Documentation** : à définir
- **Email** : blobinfini@gmail.com
- **Discord** : à définir

---

_Blobinfini - Connecter les riders, simplifier les sessions, protéger l'océan_ 🌊

## ✍️ Blobosphère – MDX + Git + Decap CMS (nouveau)

L’édition de la Blobosphère repose sur des fichiers **MDX** versionnés dans Git et éditables via **Decap CMS** (ancien Netlify CMS).

Chemins et structure
- Dossiers de contenu: `apps/web/content/blobosphere/`
  - `surf/`, `kitesurf/`, `communaute/`, `impact/`
  - Chaque dossier contient des fichiers `.mdx` avec frontmatter YAML:

```yaml
---
title: string
slug: string
category: "surf" | "kitesurf" | "communaute" | "impact"
tags: [string]
excerpt: string
status: "draft" | "published"
publishedAt: YYYY-MM-DD
updatedAt: YYYY-MM-DD | null
coverImage: string | null
readingTime: number | null
language: "fr"
---
```

Exemples inclus
- `apps/web/content/blobosphere/surf/wax-debutant.mdx`
- `apps/web/content/blobosphere/kitesurf/choisir-aile.mdx`
- `apps/web/content/blobosphere/communaute/mentorat.mdx`
- `apps/web/content/blobosphere/impact/eco-gestes.mdx`

Admin (Decap CMS)
- Fichiers: `apps/web/public/admin/index.html` + `apps/web/public/admin/config.yml`
- Ouvre: `http://localhost:PORT/admin` (ex: 3011)
- Par défaut `local_backend: true`. Pour GitHub, remplace `backend` dans `config.yml` (voir commentaires) et configure l’auth.

Chargement des articles (côté Next)
- Le listing `/blobosphere` lit réellement les `.mdx` via `apps/web/lib/blobosphere/content.ts` (fs + frontmatter minimal)
- Le frontmatter est parsé, l’extrait et un temps de lecture approximatif sont calculés si absents.
- Les filtres (thèmes) et le JSON‑LD continuent de fonctionner.

Ajouter un article via /admin
1) Va sur `/admin`, choisis la rubrique (Surf, Kitesurf, Communauté, Impact)
2) “New” → saisis le frontmatter + corps Markdown
3) Publie (ou enregistre en brouillon). Le fichier `.mdx` sera créé dans le dossier correspondant.

Automatisations IA (préparation)
- Les fichiers MDX permettent des workflows n8n: extraction des titres, génération d’extrait, calcul des tags, push PR Git.
- Un connecteur MCP (LM Studio) pourra générer des brouillons MDX à partir d’un prompt ou d’un lien source.

Notes SEO
- Les thèmes surf/kitesurf/communauté/impact structurent la navigation et le maillage interne.
- JSON‑LD Collection + Article + FAQ sont émis depuis `/blobosphere`.
