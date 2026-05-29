# 🏄 Blob – Monorepo IA

## 📋 Mission pour l'IA

Ce monorepo contient la version vivante de **Blob**, plateforme de mise en relation pour les sports de glisse (surf/kitesurf).

**Votre mission** : Contribuer directement ici. Ignorez l'ancien projet `/blobevolution` (archivé). Pour un rappel historique uniquement, consultez `ai/context/migration_from_blobevolution.md`.

**Référence IA** : Ce README, `AGENTS.md` et `claude.md` sont les guides officiels pour nos IA (Codex, ChatGPT-5, Claude Code) et l’équipe humaine.

**Focus stratégique** : La Blobosphère est l’outil clé pour amplifier la visibilité de Blob via du contenu partageable (SEO + réseaux sociaux).

## 🏷️ Naming produit (IMPORTANT)

- **Blob** = nom visible utilisateur dans les interfaces, emails, pages publiques et textes marketing.
- **BlobConnect** = nom projet/plateforme technique ou historique interne lorsque le dépôt l'emploie encore.
- **BlobSurf / blobsurf.com** = domaine public actuel de déploiement.
- **Blobinfini** = legacy technique à conserver uniquement là où il existe encore dans les namespaces, packages, variables ou historiques.
- Ne pas “renommer en masse” (variables, packages, env, Sentry, Firebase, URLs) sans ticket/validation : risque casse SEO, config, observabilité, clés, routes.
- Dans les textes UI, emails et pages publiques, afficher **Blob**.

Le dépôt GitHub s'appelle encore techniquement `blobevolutionClaudeCodex`. C'est un nom de dépôt historique, pas le nom produit.

## 🌍 Domaine public actuel

Les domaines publics confirmés par `docker/Caddyfile` et `docs/ops/monitoring-blobsurf.md` sont :

- Site/app : `https://blobsurf.com`
- API : `https://api.blobsurf.com`
- Stockage public MinIO : `https://storage.blobsurf.com`

`docker-compose.vps.yml` reste paramétrable via `APP_DOMAIN`, `API_DOMAIN` et `STORAGE_DOMAIN`. Les valeurs `*.blobinfini.local` visibles dans certains exemples sont des placeholders techniques locaux, pas des domaines publics.

## 🎯 Vision Produit

Blob connecte les passionnés de sports de glisse en proposant :

- **Matching intelligent** entre riders basé sur géolocalisation, niveau et affinités
- **Publication de demandes géolocalisées** : un particulier publie une intention de cours (surf/kitesurf) ; les professionnels dans leur périmètre configuré voient les demandes locales
- **Consultation réciproque des profils** : les deux parties peuvent consulter la fiche de l’autre avant de prendre contact
- **Messagerie intégrée** pour organiser librement le cours — sans réservation ni paiement orchestrés par la plateforme
- **(Reporté)** Gamification communautaire (systèmes de points/badges) – hors scope MVP
- **BloboMap** : outil de visualisation à destination des professionnels pour identifier les demandes géolocalisées dans leur zone d’activité
- **Blobosphère éditoriale** pour publier articles/photos et renforcer la visibilité de Blob

### Utilisateurs cibles

- **Riders** : Surfeurs/kitesurfeurs 25-45 ans cherchant partenaires ou cours
- **Professionnels** : Moniteurs indépendants et écoles cherchant visibilité
- **Objectif inclusion** : Interface accessible, effort particulier pour attirer les femmes dans ces sports

### ♿ Accessibilité

- **Panneau accessibilité** : un module persistant (`apps/web/components/accessibility`) permet d’activer contraste élevé, police agrandie, police Atkinson Hyperlegible et réduction des animations (stockage local + respect `prefers-reduced-motion`).
- **Navigation clavier** : lien “Aller au contenu principal”, `main#main-content` focusable et annonceur de changement de route `RouteAnnouncer` pour lecteurs d’écran.
- **Contrastes dynamiques** : les thèmes reposent sur les variables CSS Tailwind ; activer le mode contraste élevé force des valeurs RGAA (texte clair, bordures renforcées, focus visibles).
- **Mode clair/sombre** : un bouton persistant en bas à droite permet de basculer à tout moment entre clair et sombre (préférence mémorisée dans le navigateur et initialisée selon `prefers-color-scheme`).

## 🏗️ Architecture actuelle

### Stack technique active

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
  - Stripe (paiements — hors scope MVP, non actif)
  - Brevo SMTP (emails VPS/pre-prod/prod)
  - Mailpit (emails local/dev uniquement)
  - OpenStreetMap + Leaflet (cartographie active)
  - Firebase (notifications push)

Infrastructure:
  - Docker Compose (dev)
  - Hetzner VPS + Docker Compose (production)
  - Caddy (reverse proxy TLS + Let's Encrypt)
  - GitHub Actions (CI puis Deploy VPS)
  - Firebase (push notifications)
  - PostGIS activé (image `postgis/postgis:15-3.4` pour dev & CI)
```

### Infrastructure actuelle de production

Le chemin de production actuel est :

```text
local -> GitHub -> GitHub Actions CI -> Deploy VPS -> Hetzner VPS
```

Sur le VPS, `docker-compose.vps.yml` lance le frontend Next.js, l'API Express,
PostgreSQL/PostGIS, Redis, MinIO et Caddy. Caddy est le reverse proxy TLS officiel:
il route `$APP_DOMAIN` vers `web:3000`, `$API_DOMAIN` vers `api:4000` et
`$STORAGE_DOMAIN` vers `minio:9000`.

Les alternatives d'hebergement manage (Render, Railway, Fly.io, Clever Cloud) ont
ete etudiees historiquement, mais ne constituent plus le chemin principal de
deploiement du projet.

### Structure Monorepo - Phase MVP (exemple, recommandé pour démarrer)

```
blobevolutionClaudeCodex/        # nom de dossier historique
├── apps/
│   ├── web/                    # Next.js PWA
│   │   ├── app/               # App Router pages
│   │   ├── components/        # Composants React
│   │   └── lib/               # Hooks, utils
│   └── api/                    # API Express monolithique modulaire
│       ├── src/
│       │   ├── modules/
│       │   │   ├── admin/       # Gouvernance & modération
│       │   │   ├── analytics/   # Analytics
│       │   │   ├── auth/        # 🔐 Module authentification
│       │   │   │   ├── auth.controller.ts
│       │   │   │   ├── auth.service.ts
│       │   │   │   ├── auth.guard.ts
│       │   │   │   ├── strategies/
│       │   │   │   └── dto/
│       │   │   ├── blobosphere/ # Contenus éditoriaux & partage social
│       │   │   ├── booking/     # Legacy technique: demandes de contact / mise en relation
│       │   │   ├── chat/        # Messagerie temps réel
│       │   │   ├── consent/     # Consentement & publicité
│       │   │   ├── contact/     # Contact & support
│       │   │   ├── matching/    # Algorithme matching
│       │   │   ├── pro/         # Profils pros
│       │   │   ├── profile/     # Profils riders
│       │   │   ├── push/        # Notifications push
│       │   │   ├── reports/     # Signalements
│       │   │   └── security/    # Sécurité & audits
│       │   ├── middleware/     # Rate limit, CORS, etc.
│       │   └── lib/           # Redis, Prisma, etc.
│       └── Dockerfile
├── packages/
│   └── database/               # Prisma schemas + client
├── types/                      # Types TypeScript partagés (actuel)
├── docker-compose.yml
├── turbo.json                  # Turborepo config
└── claude.md                   # Guide IA
```

### Structure Services Découplés - Phase Scale (historique / exploratoire)

Cette structure n'est pas l'architecture active du MVP. Elle reste une piste
historique pour un éventuel découpage futur si le volume d'usage le justifie.

```
blobevolutionClaudeCodex/        # nom de dossier historique
├── services/                   # Microservices (après 1000+ users)
│   ├── auth-service/          # Service auth dédié
│   ├── matching-service/      # Service matching dédié
│   ├── payment-service/       # Service paiements dédié (si réactivé)
│   └── chat-service/          # Service chat dédié
```

## 🔐 Architecture Authentification

L'authentification active reste un **module dans l'API principale**. Côté
client, la session repose sur des cookies HttpOnly envoyés automatiquement ;
les JWT/refresh tokens existent encore comme mécanisme technique API, mais ne
doivent pas être stockés ni manipulés par le front.

```typescript
// apps/api/src/modules/auth/
├── auth.controller.ts    # login/register/refresh/logout/2FA + cookies HttpOnly
├── auth.service.ts       # tokens API, bcrypt, sessions, email
├── auth.guard.ts         # validation JWT API + cookies accessToken
├── auth-session-context.ts # liaison express-session / contexte auth
└── dto/
    ├── register.dto.ts    # Validation inscription
    └── login.dto.ts       # Validation connexion
```

### Fonctionnalités Auth (État Actuel)

- ✅ **Registration avec vérification email** (implémenté)
- ✅ **Connexion via session/cookies HttpOnly côté client** (implémenté)
- ✅ **Refresh API via cookie `refreshToken` HttpOnly** (implémenté)
- ✅ **Reset password sécurisé** (implémenté)
- ✅ **Sessions serveur `express-session` + contexte auth lié** (implémenté)
- ✅ **Logout avec révocation refresh et suppression cookies** (implémenté)
- ✅ **RGPD: consentement, export, suppression** (implémenté)
- ✅ **2FA obligatoire pour pros** (implémenté - activation via email + code 2FA)
- ⏳ **Social login** (Google, Facebook) (Phase 2 - exemple)

À ne pas faire côté front : stocker `accessToken`/`refreshToken`, injecter un
Bearer token depuis `localStorage`, ou traiter `localStorage` comme preuve
d'authentification. Le front peut conserver uniquement des hints non sensibles
comme `blob_session_hint`.

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
- ✅ **Hébergement données en Europe** (VPS Hetzner / hébergeur UE)

### ✅ Sécurité Technique (Implémenté)

- ✅ **Validation Zod** sur TOUS les inputs API
- ✅ **Prisma ORM** exclusif (pas de SQL raw)
- ✅ **Rate limiting intelligent** (170+ endpoints protégés)
- ✅ **CSRF tokens** obligatoires sur toutes mutations
- ✅ **Headers sécurité** (CSP, HSTS, XSS Protection)
- ✅ **Cookies HttpOnly + refresh API serveur** (rotation côté API)
- ✅ **2FA obligatoire pour pros** (déployé)

### Décision: Refresh tokens (détail API)

- Le refresh token existe encore côté API, mais il est transporté par cookie
  HttpOnly (`refreshToken`) et rafraîchi via `POST /auth/refresh`.
- L'access token API est aussi posé en cookie HttpOnly (`accessToken`) et
  validé par `auth.guard.ts`. Le guard accepte encore un Bearer JWT technique
  si présent, mais le chemin front standard est cookie-only.
- `localStorage` sert uniquement à des hints UX non sensibles ; la vérité de
  session vient de `GET /auth/me` et des cookies validés serveur.
- Implémentation : `apps/api/src/modules/auth/auth.controller.ts`,
  `apps/api/src/modules/auth/auth.guard.ts`, `apps/web/lib/apiClient.ts`.

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
  3. **Industrialisation** : exposer les seuils via variables d'environnement (`AUTH_MAX`, `AUTH_READ_MAX`, etc.) pour permettre un ajustement sans redeploiement.
  4. **Côté front** : garder une déduplication/caching (`optimizedApiClient.me()`, SWR…) afin d'éviter les rafales client. Lors d'une intégration tierce, imposer une limite max de 1 appel `/auth/me` par cycle de rendu.
  5. **Observabilité** : en production, monitorer les occurrences de `AUTH_RATE_LIMIT_EXCEEDED` et déclencher une alerte si elles réapparaissent une fois les seuils calibrés.

### ✅ Système d'Alertes de Sécurité (Déployé)

Un système complet de détection et notification des violations de sécurité a été implémenté pour protéger la plateforme contre les tentatives d'accès cross-role et détecter les comptes potentiellement compromis.

**Fonctionnalités clés :**

- ✅ **Détection automatique** de toutes les tentatives d'accès cross-role (PRO→RIDER, RIDER→PRO, ADMIN→PRO, ADMIN→RIDER)
- ✅ **Notifications email instantanées** aux administrateurs avec contexte complet (user, endpoint, IP, timestamp)
- ✅ **Enregistrement en base** de toutes les violations dans la table `SystemAlert` pour audit
- ✅ **Détection de comptes compromis** : même les comptes ADMIN déclenchent des alertes critiques s'ils tentent d'accéder aux endpoints PRO/RIDER
- ✅ **Tests E2E complets** : 10/10 tests de sécurité passent (security-alerts.e2e.test.ts)

### ✅ Responsible Disclosure (RFC 9116)

Le projet implémente le standard **RFC 9116** pour faciliter le signalement de vulnérabilités par les chercheurs en sécurité.

**Fichier** : `apps/web/public/.well-known/security.txt`

Ce fichier est **automatiquement accessible** publiquement via l'URL `https://blobsurf.com/.well-known/security.txt` une fois déployé. Il contient :
- Contact email pour signaler des vulnérabilités
- Politique de divulgation responsable
- Programme de bug bounty (récompenses 20€/10€/reconnaissance)
- Périmètre autorisé pour les tests de sécurité
- Conformité Code Pénal français (Art. 323-1)

**⚠️ Action requise avant production** :
Remplacer les 3 occurrences de `METTRE_EMAIL_SECURITE_ICI_AVANT_PROD@example.com` par `security@blobsurf.com` dans :
- Ligne 4 : `Contact:`
- Ligne 53 : Commentaire Contact
- Ligne 64 : Commentaire découverte accidentelle

**Comment ça fonctionne ?**
Les chercheurs en sécurité (white hat hackers) consultent automatiquement `/.well-known/security.txt` pour savoir :
1. Comment contacter l'équipe sécurité de manière responsable
2. Quel est le scope autorisé pour les tests
3. Quelles sont les récompenses offertes (bug bounty)

Ce standard est reconnu par Google, Facebook, GitHub et recommandé par l'ANSSI.

**Configuration requise :**

```bash
# Variables d'environnement obligatoires
ADMIN_EMAIL=admin@blobsurf.com  # Email(s) recevant les alertes (séparés par virgules)

# Configuration SMTP local/dev (Mailpit)
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
```

En VPS, pré-prod et prod réelle, l'envoi SMTP doit utiliser Brevo (`SMTP_HOST=smtp-relay.brevo.com`) via `.env.vps`. Mailpit est interdit hors local/dev.

**Violations détectées :**

1. **PRO → RIDER** : Un compte PRO tente d'accéder aux endpoints RIDER (`/profile/me`, `/profile/photo/upload-url`, etc.)
2. **RIDER → PRO** : Un compte RIDER tente d'accéder aux endpoints PRO (`/pro/me`, `/pro/offers`, etc.)
3. **ADMIN → PRO** : Un compte ADMIN tente d'accéder aux endpoints PRO (indication de compte compromis)
4. **ADMIN → RIDER** : Un compte ADMIN tente d'accéder aux endpoints RIDER (indication de compte compromis)

**Endpoints admin pour consulter les alertes :**

```typescript
GET /admin/alerts             // Liste toutes les alertes de sécurité
GET /admin/alerts/:id         // Détails d'une alerte spécifique
PUT /admin/alerts/:id/resolve // Marquer une alerte comme résolue
```

**Documentation complète :** Voir [SECURITY_ALERT_SYSTEM.md](./SECURITY_ALERT_SYSTEM.md) pour l'architecture détaillée, les workflows de réponse aux incidents, et les procédures de maintenance.

## ⚡ Performance & Temps Réel

### Politique Polling Multi-Onglets (Dashboard)

**Objectif**: Économie serveur + Fiabilité + Coordination multi-onglets.

**Principe**: Au lieu que 3 onglets ouverts fassent 3 polls indépendants (3x coût API), un seul onglet "leader" poll pour tous → **économie 66% requêtes**.

**Règles d'or**:
- ✅ Onglet visible (`visibilityState === 'visible'`) → 1 leader poll toutes les 60s
- ✅ Onglet hidden → stop net (pas de leader, pas de poll)
- ✅ Focus/visibilitychange → refresh immédiat (1 call) puis reprise 60s

**Mécanisme**:
- Leader election via "lease" localStorage (TTL 3s, renouvellement 1.5s)
- `tabId` sessionStorage + `instanceNonce` runtime pour éviter duplicate tab
- Validation stricte JSON + auto-réparation si storage corrompu
- AbortController réel (timeout 10s annule HTTP, pas juste flag)
- Convergence < 2s garantie (checks 500ms au startup)

**Tests**:
- Playwright: convergence 1 seul leader (expect.poll CI-safe)
- Playwright: abort timeout + preuve `setUnreadTotal` skip
- Unit: safe storage wrappers (QuotaExceeded graceful)

**Documentation complète**: Voir [docs/POLLING_MULTITABS.md](./docs/POLLING_MULTITABS.md)

**Fichiers clés**:
- `apps/web/app/dashboard/page.tsx` (section « Politique Polling Multi-Onglets » de ce document)
- `apps/web/lib/storage.ts` (safe wrappers)
- `apps/web/tests/e2e/dashboard-polling-convergence.spec.ts`

### Stratégie Temps Réel (WebSocket)

**Principe**: Temps réel **uniquement** quand utilisateur regarde activement l'information. Pas de WebSocket global permanent.

**Règles strictes**:
- ✅ WebSocket **page-scoped** (connexion au mount, déconnexion au unmount)
- ✅ Temps réel seulement si < 5s latence critique (messagerie)
- ❌ Jamais de polling < 10s pour simuler temps réel
- ❌ Jamais de WebSocket ouvert "au cas où"
- ❌ Jamais de broadcast global serveur (`io.emit()` interdit, utiliser `io.to(room)`)

**Architecture actuelle**:
- **Messagerie**: WebSocket page-scoped (`apps/web/app/messages/[id]/page-websocket.tsx`)
  - Connexion uniquement si page conversation ouverte
  - Auth via cookie HttpOnly `accessToken` envoyé au handshake (JWT seulement côté API)
  - Rooms par conversation (isolation broadcast)
  - Fallback HTTP si WS fail
- **Dashboard**: Polling optimisé 60s (voir ci-dessus)
- **Demandes de cours**: Fetch + push notification (pas de WS permanent)
- **Blobomap**: Fetch on interaction (pas de temps réel)

**Documentation complète**: Voir [docs/ARCHITECTURE_REALTIME.md](./docs/ARCHITECTURE_REALTIME.md)

**Fichiers clés**:
- `apps/web/lib/socket.ts` (client Socket.io singleton)
- `apps/web/hooks/useSocket.ts` (hook connexion WS)
- `apps/web/hooks/useChat.ts` (hook messagerie + fallback HTTP)
- `apps/api/src/lib/socket.ts` (serveur Socket.io + auth)

### Quand Utiliser Quoi

| Feature | Mode Recommandé |
|---------|-----------------|
| Dashboard unread count | Polling leader (60s) |
| Messages temps réel | WebSocket (`apps/web/lib/socket.ts`) |
| Demandes de cours | Fetch + Push/Email (pas de WS permanent) |
| Map/Search | Fetch à l'interaction |
| Notifications badge | Push FCM (`apps/web/lib/firebase.ts`) |

## 📊 Fonctionnalités par Phase (exemple)

### ✅ Phase 1 (exemple) - MVP (statut historique, à confirmer)

- ✅ **Auth Module complet** : inscription, connexion via cookies HttpOnly, reset password, RGPD
- ✅ **Matching & Géolocalisation** : algorithme intelligent PostGIS
- ✅ **Mise en relation** : publication de demandes géolocalisées, visualisation BloboMap, contact via messagerie
- ✅ **Chat temps réel** : Socket.io avec anti-contournement
- 🟡 **PWA avancée** : installation/offline prouvés selon modules ; push notifications à confirmer de bout en bout
- ✅ **Performance optimisée** : cache Redis, requêtes N+1 éliminées
- ✅ **Sécurité production** : CSRF, rate limiting, RGPD complet
- ⏸️ **Paiement / transaction** : hors scope MVP — l'organisation financière du cours se fait hors plateforme
- ⏳ **Blobosphère MVP** : CMS éditorial (en cours)


### 🚀 Phase 2 (exemple) - Croissance (priorités à confirmer)

- 🔜 **Fonctionnalités professionnelles avancées** (exploratoire post-MVP) : outils premium / abonnement si l'adoption terrain valide un réel intérêt — hors scope actuel
- 🔥 **Tests unitaires** : couverture 80%+ pour stabilité production
- 📈 **Blobosphère enrichie** : CMS complet + SEO + partage social
- 📊 **Analytics avancées** : tableau de bord business + métriques
- 🎯 **Social login** (Google, Facebook) pour conversion
- 🤖 **Matching ML** multi-critères intelligent
- 🏆 **Système réputation** (notes/avis post-session)

### Phase 3 (exemple) - Scale (12 mois, estimation)

- [ ] **Migration auth vers service dédié**
- [ ] Multi-sports (windsurf, paddle)
- [ ] API publique REST/GraphQL
- [ ] Chatbot IA (Blobot – R&D, non activé dans le MVP)
- [ ] Camps/stages (exploratoire post-MVP, sans booking actif)
- [ ] Marketplace équipement
- [ ] Internationalisation

## 🤖 Configuration MCP (Model Context Protocol)

### Serveurs MCP Disponibles

Le dépôt technique **blobevolutionClaudeCodex** est configuré pour utiliser plusieurs serveurs MCP qui enrichissent les capacités des IA :

#### Pour Claude Code (CLI)
Configuration : `~/.config/claude-code/mcp.json`

```json
{
  "mcpServers": {
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

**Capacités** :
- **Chrome DevTools MCP** : Automatisation navigateur, debugging, screenshots, analyse de performance
- **GitHub MCP** : Consultation, recherche et création d’issues/PR directement depuis Claude Code

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

### Documentation Complète

Voir `docs/mcp-setup.md` pour :
- Installation détaillée
- Obtention des tokens
- Utilisation par les IA
- Dépannage

## 🚀 Instructions pour l'IA

### Lignes directrices

- Travaillez exclusivement dans le dépôt `blobevolutionClaudeCodex` (nom historique, pas nom produit).
- Respectez l'architecture modulaire (`apps/api/src/modules/*` : auth, contact, chat, matching, blobosphere, consent, profile/pro, push, security, etc.). Le module `booking` existe encore comme legacy technique et ne doit pas être renommé en masse.
- Intégrez le module `blobosphere` (contenus éditoriaux) pour renforcer la visibilité externe.
- Utilisez les serveurs MCP disponibles (Sentry, GitHub, Playwright, Chrome DevTools, Context7) pour enrichir vos capacités d'analyse.
- Sécurité systématique : Zod sur tous les inputs, Prisma uniquement, rate limiting, CSRF, headers de sécurité.
- Auth : session/cookies HttpOnly côté client, refresh côté API, 2FA obligatoire pour les pros, aucune persistance de tokens côté front.
- RGPD : consentement explicite, anonymisation, droit à l'oubli, export des données.
- Performance : PostGIS, Redis, index composites, pagination cursor-based.
- Qualité : TypeScript strict, tests unitaires/E2E, couverture ≥ 80 %.
- CI/CD : utilisez les scripts fournis (`pnpm run build`, `pnpm test`, etc.) et surveillez la GitHub Action `CI`.

### Processus recommandé

1. Lisez `claude.md` et ce README avant chaque session.
2. Clarifiez le périmètre (feature/bug) et proposez un plan de travail court.
3. Priorisez les modules critiques (auth par défaut) si la priorité n’est pas spécifiée.
4. Livrez par petits commits/diffs, avec migrations et seeds synchronisés.
5. Vérifiez les impacts Blobosphère (SEO, partage, rôles admin) si votre changement touche l’éditorial.
6. Ajoutez/actualisez tests, seeds, SEO metadata et documentation.
7. Exécutez `pnpm run lint`, `pnpm run type-check` et `pnpm test` avant de soumettre.

## 💻 Commandes de Développement

```bash
# Installation rapide
git clone https://github.com/vigierAudrey/blobevolutionClaudeCodex.git
cd blobevolutionClaudeCodex
pnpm install

# Setup environnement (première fois uniquement)
cp .env.example .env
# Puis remplacez immédiatement EMAIL_HASH_SECRET par une valeur forte et unique
# Exemple: openssl rand -base64 48 | tr -d '\n'
docker compose up -d postgres redis minio mailpit
pnpm run db:reseed  # Base + données de test

# Développement
pnpm run dev:all      # Lance API (port 4000) + Frontend (port 3002)
pnpm run dev:api      # API seulement
pnpm run dev:web      # Frontend seulement

# Base de données
pnpm run db:migrate   # Applique les migrations
pnpm run db:seed      # Charge les données de test
pnpm run db:reset     # Reset complet (drop + migrate + seed)
pnpm run db:studio    # Interface admin Prisma

# Build et tests
pnpm run build        # Build de production
pnpm run type-check   # Vérification TypeScript
```

`blobevolutionClaudeCodex` est le nom du dépôt historique GitHub. Le produit public s'appelle Blob et le domaine public actuel est `blobsurf.com`.

## 🖼️ Configuration des Images (Next.js + MinIO)

### Configuration Locale et Production

Next.js nécessite une configuration explicite des domaines autorisés pour le composant `next/image`. Le fichier `apps/web/next.config.mjs` contient la configuration pour MinIO :

```javascript
images: {
  remotePatterns: [
    {
      protocol: 'http',
      hostname: 'localhost',
      port: '9000',
      pathname: '/blobinfini-dev/**',
    },
  ],
},
```

**⚠️ Points importants :**

1. **Redémarrage obligatoire** : Après toute modification de `next.config.mjs`, vous devez **redémarrer le serveur Next.js** (Ctrl+C puis `pnpm run dev`)
2. **Environnements multiples** : Pour la production, ajoutez un nouveau pattern dans `remotePatterns` avec :
   - Le hostname de production de MinIO exposé par Caddy (`storage.blobsurf.com`)
   - Le protocol `https` (recommandé)
   - Le pathname correspondant au bucket de production (`S3_BUCKET`, ex: `blobinfini-vps` tant que le bucket legacy n'est pas renommé)

**Exemple de configuration multi-environnements :**

```javascript
images: {
  remotePatterns: [
    // Développement local
    {
      protocol: 'http',
      hostname: 'localhost',
      port: '9000',
      pathname: '/blobinfini-dev/**',
    },
    // Production
    {
      protocol: 'https',
      hostname: 'storage.blobsurf.com',
      pathname: '/blobinfini-vps/**',
    },
  ],
},
```

**Erreur courante :** Si vous voyez `Error: Invalid src prop... hostname is not configured`, c'est que le domaine de l'image n'est pas autorisé dans `next.config.mjs`.

## 🌐 Déploiement VPS

Le frontend Next.js (`apps/web`) et l'API Express (`apps/api`) sont construits et servis par Docker Compose sur le VPS Hetzner.

Chemin de livraison :

```text
local -> GitHub -> CI GitHub Actions -> Deploy VPS -> Hetzner VPS
```

- ✅ **GitHub Actions `CI`** : lint, type-check, tests unitaires, tests API E2E et job Playwright (`e2e-tests`) qui rejoue les scénarios web critiques (`pnpm run test:e2e`). Le job provisionne Postgres, applique `db:generate`, `db:migrate:deploy`, `db:reseed`, installe les navigateurs Playwright puis lance les tests.
- ✅ **GitHub Actions `Deploy VPS`** : déclenché après CI verte sur `main`, connexion SSH au VPS, `git reset --hard origin/main`, build Docker `api` + `web`, `prisma migrate deploy`, `docker compose up -d`, puis `scripts/smoke-test-vps.sh`.
- ✅ **VPS** : stack `docker-compose.vps.yml` avec Caddy comme reverse proxy TLS officiel.
- ✅ **Secrets** : les secrets de déploiement vivent dans GitHub Actions (`Settings -> Secrets and variables -> Actions`) ou dans `.env.vps` sur le VPS. Aucun secret ne doit être commité.

Voir `docs/ops/deploy-vps.md` pour le deploiement automatique et `docs/runbooks/vps-runtime.md` pour l'exploitation runtime VPS.

### Ops / exploitation VPS

Le dépôt prouve une base VPS opérationnelle, mais l'exploitation complète n'est
pas encore à considérer comme terminée.

| Sujet | Statut README | Preuve dépôt |
|---|---|---|
| Environnement local | Terminé | `docker-compose.yml`, Mailpit, Postgres, Redis, MinIO |
| VPS privé / préproduction | Partiellement réalisé | `docker-compose.vps.yml`, `docker/Caddyfile`, Brevo, MinIO, Redis, Postgres |
| Production publique | À confirmer | domaines documentés, lancement public non prouvé uniquement par le dépôt |
| Backups PostgreSQL | Terminé | `scripts/backup-blobsurf.sh`, `scripts/backup-pg.sh`, `scripts/restore-pg.sh` |
| Backup MinIO | À faire | `scripts/backup-minio.sh` absent |
| Chiffrement `age` + upload R2 | Partiellement réalisé | `scripts/setup-backup-keys.sh`, `scripts/backup-encrypt-upload.sh`, `scripts/r2-rotate.sh`, `scripts/r2-restore-test.sh` |
| Monitoring | Partiellement réalisé | `/health`, `/security/health`, `docs/ops/monitoring-blobsurf.md`; scripts cron finaux à confirmer |
| Alerting Discord | À confirmer | `DISCORD_WEBHOOK_URL` documenté, `scripts/alert.sh` absent |
| PRA complet | À faire | procédure complète de reprise à formaliser et tester |

Mailpit est réservé au local/dev. Tout environnement VPS réel doit utiliser
Brevo SMTP et les secrets `.env.vps` / GitHub Actions.

### 🔧 Tests Locaux avec `act`

Pour tester les workflows GitHub Actions en local avec `act` :

```bash
# Installer act (si pas déjà fait)
brew install act  # macOS
# ou
curl https://raw.githubusercontent.com/nektos/act/master/install.sh | sudo bash  # Linux

# Exécuter les workflows localement (le job e2e-tests requiert Docker disponible pour le service Postgres)
act -j build-and-test
act -j e2e-tests
```

⚠️ Le job `e2e-tests` attend un service Postgres nommé `postgres` (comme en CI); assurez-vous qu’`act` soit configuré avec Docker disponible.

### Archive historique — Politique de nettoyage Jest (2025)

1. **Résumé** – Les suites e2e critiques reconstruisent leurs fixtures dans un `beforeEach()`. Chaque scénario repart ainsi d’un environnement neuf, sans dépendre des créations effectuées par un test précédent.
2. **Description technique** – `apps/api/jest.setup.db.ts` vide désormais l’ensemble des tables entre les suites Jest sans aucune exception dans `skipCleanupPatterns`. Cette politique rend la CI plus prévisible et prépare la migration Prisma 7.

### 📦 Architecture de Déploiement

```text
GitHub Repository (origin)
    |
    | push / pull request
    v
GitHub Actions "CI"
    |- lint / type-check / tests
    |- API E2E
    `- Playwright E2E
    |
    | main + CI verte
    v
GitHub Actions "Deploy VPS"
    |
    | SSH
    v
Hetzner VPS
    |- Caddy TLS (80/443)
    |- web:3000
    |- api:4000
    |- postgres:5432
    |- redis:6379
    `- minio:9000 via storage domain uniquement
```

GitHub Actions est la source de vérité CI/CD avant déploiement VPS. `act` reste utile pour rejouer certains jobs localement.

### 🚀 Workflow de Développement

1. **Développement local** :
   - Chemin A (API hors Docker): `pnpm run dev:all`
   - Chemin B recommandé (API dans Docker): `pnpm run dev:all:docker`
     - Démarre l'infra Docker (Postgres, Redis, MinIO, Mailpit) et l'API dans Docker
     - Lance le frontend Next.js en local sur `http://localhost:3002`
2. **Créer une branche** : `git checkout -b feat/nouvelle-fonctionnalite`
3. **Validation locale (recommandée)** avec `act` (voir ci-dessous)
4. **Commit et push** : `git push origin feat/nouvelle-fonctionnalite`
5. **GitLab CI (optionnel)** : `git push gitlab` si configuré comme backup
6. **Merge vers `main`** → GitHub Actions `CI`
7. **CI verte sur `main`** → GitHub Actions `Deploy VPS`
8. **Smoke test VPS** → `scripts/smoke-test-vps.sh`

#### Validation locale (recommandée) avec act

- `act` exécute localement les jobs définis dans `.github/workflows/ci.yml` (lint, type-check, tests, e2e).
- Exemples de commandes (jobs existants) :

```bash
act -l
act -j lint
act -j type-check
act -j build-and-test -P ubuntu-latest=catthehacker/ubuntu:act-latest
```

- Au premier lancement, choisir l'image "Medium" ; `act` mémorise ce choix.

#### Validation distante (optionnelle) avec GitLab CI

- `git push gitlab` déclenche le pipeline GitLab (si configuré).
- Rappel : `origin` = GitHub (source de vérité), `gitlab` = remote secondaire.

### 🎯 Bonnes Pratiques

- ✅ Local first : lancez `act` avant de push (lint/type-check/tests/e2e)
- ✅ GitLab CI sert de backup quand GitHub Actions est bloqué par quota
- ✅ La CI GitHub reste la source de vérité avant déploiement VPS
- ✅ Vérifiez les logs GitHub Actions et les logs Docker du VPS en cas d'erreur


## 🔔 Push Notifications / Firebase (partiel, à confirmer)

Firebase FCM existe dans le dépôt comme piste technique pour les notifications
push, avec service worker, helpers front et routes API. Ce bloc ne doit pas être
lu comme une garantie de canal push production déjà validé de bout en bout.

État prudent :

- **Confirmé** : code front/back autour de Firebase FCM et PWA.
- **À confirmer** : configuration Firebase réelle, inscription/désinscription
  des tokens en production, monitoring et tests bout en bout.
- **MVP actuel** : les demandes de contact et notifications pros peuvent rester
  opérées via API/email tant que le canal push n'est pas validé.

Conserver Firebase comme historique/exploratoire actif, pas comme dépendance
critique de la stack VPS.

## 📋 Archive historique — changements 2025

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
- Amplifier la visibilité de Blob via un espace éditorial riche (articles, interviews, reportages photo).
- Créer un tunnel d’entrée SEO/social : chaque contenu dispose d’URL publiques optimisées et de métadonnées partageables.
- Offrir aux riders/pros un lien direct depuis leurs univers respectifs pour explorer l’actualité de la communauté.

### Parcours utilisateur
- Depuis les sections Riders et Pros, un lien “Explorer la Blobosphère” ouvre `/blobosphere` (nouvelle route Next.js).
- Contenus structurés par thèmes (spots, riders, pros, écologie). Possibilité de filtrer et de rechercher.
- Boutons de partage social (X/Twitter, Facebook, Instagram, LinkedIn) avec prévisualisations OG/Twitter Cards.

### Gestion éditoriale (Admin)
- Les comptes `ADMIN` accèdent à `/admin/blobosphere` (guardé) pour rédiger, prévisualiser et publier.
- Configurez le compte admin principal via `PRIMARY_ADMIN_EMAILS` (par défaut `dev+admin@test.com`). Les emails listés y possèdent automatiquement **toutes** les permissions admin pour débloquer les sections `/admin/*`.
- Nouveauté diffusions : depuis `/admin/conversations/broadcast`, un admin peut envoyer un message dans la messagerie interne de tous les riders, de tous les pros ou d'une liste d'emails précise (conversation `ADMIN_TO_USER`). Les actions sont historisées et peuvent être désactivées via `/admin/conversations/unblock-all` en cas d'incident.
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
- Stockage médias : S3/MinIO (voir `docs/blobosphere.md`), génération de formats responsive.
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
- Lancement initial : le matching géolocalisé reste temporairement limité à la France métropolitaine et à la Corse.
- Données conservées : préférences sport, niveau, zone géographique, demandes de session, consentements RGPD.

**Parcours MVP**

1. Inscription + vérification email (support rider ou pro).
2. Configuration du profil et consentement géolocalisation.
3. Exploration de `/matching`, envoi d’une demande de session et échanges avec le pro.
4. Validation finale hors plateforme (paiement non géré dans Blob pour le MVP).

### Pros (Professionnels)

**Profil & données**

- Profil `ProProfile` (nom commercial, bio, photo/logo, lieu de travail lat/lng, `verified`).
- Lancement initial : création/édition des comptes et profils pro temporairement limitées à `countryCode=FR`, avec contrôle serveur des coordonnées France métropolitaine + Corse.
- Informations tarifaires non exposées en UI (données conservées en base pour usage interne uniquement).
- Demandes reçues, visibilité locale et journal d’audit pro.
- Pièces justificatives partagées hors plateforme : les utilisateurs doivent vérifier directement les documents fournis par le professionnel.
- Auth renforcée avec 2FA obligatoire sur connexion.

**Parcours MVP**

1. Inscription via parcours pro + activation email.
2. Activation du 2FA (code reçu par email) à la première connexion.
3. Paramétrage du profil public et de la zone d'activité sur `/pro/profile` et `/pro/map`.
4. Visualisation des demandes géolocalisées sur la BloboMap, prise de contact via la messagerie ; l'organisation du cours se fait librement hors plateforme.

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
  - `pnpm run db:seed` → crée des comptes de démo.
  - `pnpm run db:reseed` → efface les données et réinjecte la démo (rapide, sans toucher au schéma).
  - `pnpm run db:reset` → drop + remigre + seed (reset complet).

- Démarrage rapide à copier-coller (local) :

  ```bash
  # 1. Préparer l'environnement (la copie .env est nécessaire uniquement la première fois)
  cp -n .env.example .env 2>/dev/null || true
  docker compose up -d postgres redis minio mailpit
  pnpm install
  pnpm run db:reseed

  # 2. Lancer les serveurs applicatifs (dans deux terminaux séparés)
# Démarrage dev (Chemin B – API dans Docker)
pnpm run dev:all:docker

# Démarrages ciblés
pnpm run dev:infra       # Postgres/Redis/MinIO/Mailpit (Docker)
pnpm run dev:api:docker  # API dans Docker
pnpm run dev:web         # Frontend en local (http://localhost:3002)

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
- Pas de dépendance cartographique payante.
- Extension prévue: géocodage gratuit Nominatim pour convertir adresses → lat/lng.

Activer l’envoi d’emails (dev avec Mailpit)

- Démarrer Mailpit: inclus dans `docker-compose.yml` → `docker compose up -d mailpit` (UI: http://localhost:8025)
- `.env` déjà prêt pour Mailpit: `SMTP_HOST=localhost`, `SMTP_PORT=1025`, `SMTP_SECURE=false`.
- Définir `WEB_BASE_URL` (ex: http://localhost:3002) pour générer les liens.
- `apps/api` dépend de `nodemailer`; exécutez `pnpm install` à la racine si besoin.

Mailpit ne doit pas être utilisé en VPS/pré-prod réelle: utiliser Brevo via `.env.vps` et `docker-compose.vps.yml`.

Sans SMTP actif, l’API continue de fonctionner et ignore l’envoi (log d’info seulement).

### Polling messagerie & compteur de messages non lus

- Le dashboard Rider interroge périodiquement `/conversations` pour calculer le nombre total de messages non lus.
- En développement et par défaut en production, l’intervalle est de **60 secondes** et ne s’exécute que lorsque l’onglet est actif (`document.visibilityState === 'visible'`).
- Vous pouvez ajuster cet intervalle via la variable `NEXT_PUBLIC_UNREAD_POLL_MS` (en millisecondes) côté front web (ex: `NEXT_PUBLIC_UNREAD_POLL_MS=300000` pour 5 minutes).
- À plus long terme, la roadmap prévoit de basculer ce compteur vers un flux temps réel (Socket.io) pour éviter tout polling régulier en production à forte charge.

## 📝 Patterns de Code à Suivre

### Module Auth

Extrait réel : `apps/api/src/modules/auth/dto/register.dto.ts`

```typescript
import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['RIDER', 'PRO']).default('RIDER'),
  ageConfirmed: z.literal(true, {
    errorMap: () => ({ message: 'Vous devez avoir 18 ans ou plus pour vous inscrire.' }),
  }),
  consentAccepted: z.literal(true, {
    errorMap: () => ({ message: 'Vous devez accepter les règles de sécurité des sessions.' }),
  }),
});

export type RegisterInput = z.infer<typeof registerSchema>;
```

### API Route Protégée

Les routes protégées doivent combiner garde d'authentification, contrôle de rôle, validation Zod et réponses d'erreur typées. Le module `booking` peut encore apparaître dans des noms techniques legacy, mais la documentation produit ne doit pas réintroduire de workflow de réservation orchestrée.

## 🔍 Points d'Attention Spécifiques

### Authentification

- Client : cookies HttpOnly + `credentials: include`, sans stockage de tokens côté front.
- API : JWT access + refresh token restent des détails techniques serveur, transportés par cookies et révocables.
- `express-session` lie le contexte serveur aux tokens API.
- 2FA obligatoire pour pros (activation par email + code 2FA).
- Rate limiting strict sur login/refresh.

### Matching Algorithm

- PostGIS pour requêtes géospatiales
- Redis cache pour performances
- Maximum 4 riders par groupe
- Expiration demandes jour-même
- Système verrouillage groupe (cadenas)

### Paiement & Commission (hors scope MVP)

- Pas de paiement intégré dans Blob — l'organisation financière du cours se fait hors plateforme
- Aucun prélèvement ni escrow en production
- Éventuellement exploratoire post-MVP si l'adoption terrain valide l'intérêt de fonctionnalités premium

### Messagerie

- Filtrage regex emails/téléphones
- Conversations ouvertes dans le parcours de mise en relation validé
- Archivage auto après 30 jours inactivité
- Modération IA contenus inappropriés

### Gamification (retirée)

> Les mécaniques de points, badges, concours ou mascottes personnalisées sont désactivées pour le MVP afin de concentrer l'équipe sur la mise en relation, la messagerie et la Blobosphère.

## 📚 Documentation Technique

- [**Positionnement Produit MVP**](./docs/product-positioning.md) — **Source de vérité scope fonctionnel (à lire en premier)**
- [API Documentation](./docs/api.md)
- [Database Schema](./docs/database.md)
- [Security Guidelines](./docs/security.md)
- [RGPD Compliance](./docs/rgpd.md)
- [Publicités & Consentement](./README_ADS.md)
- [Tests E2E & CI](./README_TESTS.md)
- [Migration Prisma 6](./docs/migration-prisma6.md)
- [Troubleshooting Prisma](./docs/troubleshooting-prisma.md) ⚠️ **Problèmes courants et solutions**
- [Architecture Polling Dashboard](./docs/ARCHITECTURE_POLLING_DASHBOARD.md) 🔄 **Économie serveur multi-onglets**
- [Architecture Temps Réel](./docs/ARCHITECTURE_REALTIME.md) ⚡ **WebSocket page-scoped, pas de WS global**

## 🤝 Contribution IA

### Checklist avant de coder
1. **Synchronisez le contexte** : relisez `claude.md`, ce README, `docs/product-positioning.md` (scope MVP) et les RFC pertinentes (`docs/architecture/*`).
2. **Cadrez le besoin** : story/bug, critères d’acceptation, métriques attendues (inclure impacts Blobosphère/SEO/IA).
3. **Mappez les dépendances** : migrations Prisma, seeds, feature flags, variables d’environnement, scripts CI.
4. **Partagez un plan concis** : étapes, fichiers ciblés, tests prévus; validez-le avec l’équipe avant d’écrire du code.
5. **Itérez par petits commits/diffs** : documentez les décisions et actualisez la doc associée (README, claude.md, RFC).
6. **Gardez la visibilité en tête** : pour toute feature touchant la Blobosphère, mettez à jour SEO, métadonnées de partage et analytics (`aiRedirects`).
7. **Exécutez la boucle CI locale** : `pnpm run lint`, `pnpm run type-check`, `pnpm test`, scénarios E2E obligatoires si concernés.

### Definition of Done
- ✅ Couverture de tests ≥ 80 % (unitaires + E2E ciblés).
- ✅ TypeScript strict sans `any` non justifié.
- ✅ Patterns de sécurité respectés (Zod, Prisma, rate limiting, secrets).
- ✅ Documentation actualisée (technique + guides IA) et migrations/seed incluses si besoin.
- ✅ Expérience Blobosphère vérifiée (routing public, partage social, rôle admin, contenu attractif pour IA).

## 📞 Support & Contact

- **Documentation** : à définir
- **Email** : contact@blobsurf.com (à confirmer avant production publique)
- **Discord** : à définir

---

_Blob - Connecter les riders, simplifier les sessions, protéger l'océan_ 🌊

## ✍️ Blobosphère – MDX + Git + Décap CMS

L’édition de la Blobosphère repose désormais uniquement sur des fichiers **MDX** versionnés. Décap CMS et l’éditeur interne écrivent directement dans `apps/web/content/blobosphere`. Aucune donnée n’est chargée depuis `data.ts` (supprimé).

### ✅ To-do immédiat
- [ ] **TODO**: remplacer `repo: "<OWNER>/<REPO>"` dans `apps/web/public/admin/config.yml` par le dépôt GitHub cible avant de lancer Décap.

### Structure des fichiers
- Racine contenu: `apps/web/content/blobosphere/`
  - Sous-dossiers par catégorie: `surf/`, `kitesurf/`, `communaute/`, `impact`
  - Fichiers `.mdx` avec frontmatter standard :

```yaml
---
title: "Titre"
slug: "titre-en-kebab"
category: "surf" | "kitesurf" | "communaute" | "impact"
excerpt: "Aperçu court"
tags: ["tag1","tag2"]
status: "draft" | "published"
publishedAt: "2025-01-08"
updatedAt: "2025-01-08"
coverImage: "/uploads/cover.jpg"
readingTime: 7
---
```

- Création/écriture locale : `apps/web/lib/blobosphere/saveMdx.ts` (utilisé par les routes `/api/blobosphere/posts`).
- Lecture côté Next : `apps/web/lib/blobosphere/loadBlobospherePreviews.ts` (utilisé par `/blobosphere`, filtre automatiquement les drafts).

### Export automatique des articles
- Routes Next.js dédiées (dev uniquement) :
  - `POST /api/blobosphere/posts` → crée `apps/web/content/blobosphere/<category>/<slug>.mdx`
  - `PUT /api/blobosphere/posts/:category/:slug` → met à jour le fichier MDX existant
  - `GET /api/blobosphere/posts` et `/posts/:category/:slug` → listent/chargent les fichiers pour l’éditeur interne
- Les routes ci-dessus appellent `saveMdx.ts` et calculent automatiquement `readingTime`, `publishedAt`, etc.
- L’éditeur interne (`/admin/blobosphere/editor`) consomme ces routes, pas besoin d’API externe pour tester en local.

### Lancer Décap CMS (GitHub backend)
1. **Config `config.yml`**  
   ```yaml
   backend:
     name: github
     repo: "<OWNER>/<REPO>"    # TODO à renseigner
     branch: "main"
     base_url: "http://localhost:3002"
     auth_endpoint: "api/decap/auth"
   media_folder: "apps/web/public/uploads"
   public_folder: "/uploads"
   load_config_file: false
   collections: # … voir fichier pour le détail des champs
   ```
2. **Proxy Décap**  
   Le fichier `apps/web/app/api/decap/auth/route.ts` relaye `/api/decap/auth` vers `https://api.netlify.com/api/v1/auth/github`. Il évite les `ERR_CONNECTION_REFUSED` en local.
3. **GitHub OAuth App**  
   - GitHub > Settings > Developer settings > OAuth Apps > New OAuth App  
   - Homepage URL : `http://localhost:3002`  
   - Authorization callback URL : `http://localhost:3002/api/decap/auth/callback`  
   - Récupère `Client ID` / `Client Secret` pour la configuration Décap (popup d’auth).
4. **Démarrage**  
   - `pnpm --filter @blobinfini/web dev` (écoute sur `3002`)
   - Navigue vers `/admin/blobosphere` pour charger l’iframe Décap isolée.  
   - Le bouton “Ouvrir dans un nouvel onglet” pointe vers `/admin/index.html` si l’iframe est bloquée.

### Exporter un article `.mdx`
1. Via l’éditeur interne : `/admin/blobosphere/editor`
   - Remplis le formulaire (slug + catégorie + contenu).  
   - Clique “Enregistrer” → `POST /api/blobosphere/posts` → fichier écrit dans `apps/web/content/blobosphere/<cat>/<slug>.mdx`.
2. Via Décap CMS : `/admin/index.html`
   - Auth GitHub, sélectionne “Blobosphère”, crée ou édite un article.  
   - Les commits GitHub contiennent directement les fichiers `.mdx`.
3. Via API :  
   ```bash
   curl -X POST http://localhost:3002/api/blobosphere/posts \
     -H "Content-Type: application/json" \
     -d '{"title":"Test","slug":"test","category":"surf","status":"draft","body":"Contenu"}'
   ```

### Éditeur interne `/admin/blobosphere/editor`
1. **Créer**  
   - Accède à `/admin/blobosphere/editor`.  
   - Renseigne `title`, `slug`, `category`, `status` (draft/published), `excerpt`, `tags` et le contenu MDX.  
   - Sauvegarde → appel `POST /api/blobosphere/posts` (validation simple) → `saveMdx.ts` écrit `apps/web/content/blobosphere/<categorie>/<slug>.mdx`.
2. **Modifier**  
   - Sélectionne un article existant dans la liste.  
   - Mets à jour les champs. Un changement de slug ou de catégorie renomme automatiquement le fichier (`PUT /api/blobosphere/posts/<cat>/<slug>`).  
   - Après sauvegarde, l’éditeur recharge le fichier réel pour garder l’aperçu synchronisé.
3. **Publier**  
   - Passe `status` à `published`, puis clique sur “Prévisualiser l’article final” pour recharger `loadBlobospherePreviews()` via `/api/blobosphere/previews`.  
   - Si l’article est publié, un lien ouvre directement `/blobosphere?topic=<cat>#<slug>`.
4. **Supprimer**  
   - Passe en mode édition (sélectionne l’article).  
   - Clique sur “Supprimer l’article” puis confirme : la route `DELETE /api/blobosphere/posts/<cat>/<slug>` supprime physiquement le fichier `.mdx`.  
   - Le formulaire est remis à zéro et l’article disparaît de la liste. (Décap CMS continue à gérer la suppression via GitHub pour les commits distants.)
5. **Où se trouvent les fichiers ?**  
   - Tous les articles sont physiquement stockés dans `apps/web/content/blobosphere/<category>/<slug>.mdx`.  
   - Les dossiers sont créés à la volée si besoin.
6. **Vérifier dans `/blobosphere`**  
   - `pnpm --filter @blobinfini/web dev`
   - Ouvre `http://localhost:3002/blobosphere` et filtre par catégorie : seuls les MDX `status: published` apparaissent (chargés par `loadBlobospherePreviews()`).

### Vérifier la lecture côté `/blobosphere`
1. `pnpm --filter @blobinfini/web dev`
2. Ajoute/modifie un fichier dans `apps/web/content/blobosphere`
3. Ouvre `http://localhost:3002/blobosphere` → les articles publiés doivent apparaître.  
   - `loadBlobospherePreviews()` filtre automatiquement `status: draft` et calcule `readingTime`.

### Checklist debug (403 / 404 / proxy)
- Next.js doit tourner sur **`http://localhost:3002`** (sinon adapter `base_url` dans `config.yml`).
- `repo` doit être remplacé par le vrai dépôt GitHub (sinon Décap renvoie 404 GitHub).
- Vérifie l’URL de callback de l’OAuth App (`/api/decap/auth/callback` exactement).
- Si Décap affiche des 401/403, vider les hints locaux legacy : onglet Application > Local Storage > supprimer `blob_session_hint` et d'anciens `accessToken`/`refreshToken` s'ils existent.
- L’éditeur interne n’utilise plus `apiClient` sur `/admin/blobosphere`, évitant les requêtes parasites sur `/api/v1`.
