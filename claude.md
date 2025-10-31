# 🏄 Guide IA – Blobinfini

 Ce fichier guide nos IA (Codex, ChatGPT-5, Claude Code) dans le développement de Blobinfini. À lire avant chaque session de code.

> **Note :** ce document remplace l'ancien `CLAUDE.md`. Tous les liens internes doivent désormais pointer vers `claude.md`.

## 📌 Contexte Projet

**Blobinfini** = Marketplace communautaire pour sports de glisse (surf/kitesurf)
- **Matching** : Algorithme multi-critères (géoloc, niveau, dispo) pour connecter riders
- **Réservation** : Cours avec pros, paiement Stripe (désactivé), QR codes validation
- **Social** : Messagerie temps réel, groupes, favoris, réputation
- **Gamification** : Points "Flocons d'avoine", badges, mascotte Blob personnalisable

## 🧭 Source de vérité & IA

- Ce monorepo (`blobevolutionClaudeCodex`) est la **source unique de vérité**.
- **Ne consultez plus** l'ancien projet `/blobevolution` (archivé pour référence historique uniquement).
- Les documents de référence IA sont **README.md**, **AGENTS.md** et **claude.md** ; tout écart avec le code doit être signalé par une PR de documentation.
- Pour le contexte historique, voir `ai/context/migration_from_blobevolution.md` sans en déduire de code.
- 🎯 Focus visibilité : la Blobosphère est notre vitrine éditoriale pour attirer du trafic et des inscriptions.

## 📘 Contrats API & UI

- **Modification contrats API** :
  - Mettre à jour le fichier `openapi.yaml` (ou `.json`) avec endpoints, schémas, codes d'erreur et exemples réalistes.
  - Vérifier que l'UI Swagger (ex. `/api/docs`) se charge sans erreur et reflète les changements.
  - Synchroniser les DTO/validations Zod (`apps/api`) et les types partagés (`packages/shared`).
  - Exécuter le lint/validation OpenAPI (`npm run openapi:lint`, `spectral lint openapi.yaml`, ou équivalent) et faire tourner les tests API impactés.
- **Modification composants UI ou props** :
  - Actualiser les stories Storybook (`*.stories.tsx`) pour couvrir les nouveaux états (default/loading/error/disabled/etc.).
  - Régénérer les tests visuels (Storybook test runner, Playwright snapshots, Chromatic… selon outillage disponible) et accepter explicitement les diffs attendus.
  - Vérifier la cohérence des types côté front (`packages/ui`, `apps/web`) et mettre à jour la doc utilisateur si nécessaire.
- **Check PR obligatoire** : inclure dans la description la checklist Contrats/UI (OpenAPI à jour, stories/tests visuels à jour) avant demande de review.

## 📋 Changements récents importants

### Push Notifications PWA - Phase 1 (Sept 2025)

**Décision architecture** : Implémentation complète des notifications push avec Clever Cloud + Firebase.

**Fonctionnalités ajoutées :**
- ✅ Service Worker sophistiqué (`/public/sw.js`)
- ✅ PWA Manifest pour installation app-like (`/public/manifest.json`)
- ✅ Firebase Cloud Messaging intégration complète
- ✅ API routes push (`/api/push/subscribe`, `/test`, `/status`)
- ✅ Hooks React `usePushNotifications` pour gestion état
- ✅ Composants UI pour prompts permissions
- ✅ Notifications automatiques acceptation/refus demandes
- ✅ Analytics et gestion d'erreurs robuste

**Architecture choisie :**
```
[Frontend PWA] ←→ [Clever Cloud API] ←→ [Firebase FCM] → [Users]
```

**Pourquoi Clever Cloud + Firebase :**
- Clever Cloud : Hébergement API/DB français et simple
- Firebase FCM : Service push gratuit et universel
- Combinaison économique et robuste pour startup

**Variables d'environnement requises :**
```bash
# Clever Cloud (API)
FIREBASE_PROJECT_ID=blobinfini-prod
FIREBASE_CLIENT_EMAIL=firebase-admin@...
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----..."

# Frontend (publiques)
NEXT_PUBLIC_FIREBASE_API_KEY=your-web-api-key
NEXT_PUBLIC_FIREBASE_PROJECT_ID=blobinfini-prod
```

**Intégration automatique :**
- Push notifications envoyées lors acceptation/refus de demandes dans `booking.service.ts`
- Gestion intelligente des permissions et état d'abonnement
- Support offline avec cache et retry automatique

### Suppression du champ `partnerPref` (Sept 2025)

**Décision produit** : Simplification du matching en supprimant le critère de préférence de partenaire.

**Changements appliqués :**
- ❌ Supprimé le champ `partnerPref` du modèle `RiderProfile`
- ❌ Supprimé le champ `partner` du modèle `LastSearch`
- ❌ Supprimé complètement l'enum `PartnerPref`
- ✅ Conservé le champ `sex` pour identifier le sexe de l'individu
- 🔄 Mis à jour tous les controllers, tests et le seed
- 📊 Base de données migrée avec `prisma db push`

**Avant :**
```prisma
model RiderProfile {
  // ...
  sex         Sex         @default(UNSPECIFIED)
  partnerPref PartnerPref @default(ALL)  // ❌ SUPPRIMÉ
  // ...
}

enum PartnerPref {  // ❌ SUPPRIMÉ COMPLÈTEMENT
  ALL
  WOMEN
  MEN
}
```

**Après :**
```prisma
model RiderProfile {
  // ...
  sex         Sex         @default(UNSPECIFIED)  // ✅ CONSERVÉ
  // partnerPref supprimé
  // ...
}
```

**Impact sur le matching :**
- Le matching se base maintenant uniquement sur : géolocalisation, sport, niveau, disponibilités
- Plus de filtrage par préférence de genre de partenaire
- Interface simplifiée pour les utilisateurs

### Affichage de la date sélectionnée (Sept 2025)

**Décision produit** : Afficher la date sélectionnée dans les cartes de profils sans l'utiliser dans l'algorithme de matching.

**Changements appliqués :**
- ✅ Ajout de la fonction `formatDateForDisplay()` dans `/apps/web/app/matching/cards/page.tsx`
- ✅ Affichage de la date avec icône 📅 dans chaque carte de profil
- ✅ Formatage intelligent : "Aujourd'hui", "Demain", "Peu importe", ou date formatée

**Comportement :**
- La date sélectionnée est visible dans chaque carte de profil
- Format d'affichage : "Aujourd'hui", "Demain", "Peu importe" ou "mer. 18 sept"
- La date n'influence PAS l'algorithme de recherche (uniquement affichage)
- Permet aux utilisateurs de se rappeler de leur sélection lors du swipe

## 🏗️ Architecture Technique

### Stack Principal
```
Frontend:  Next.js 14 (App Router) • TypeScript • Tailwind CSS • Shadcn/ui • PWA
Backend:   Node.js • Express • Prisma ORM • PostgreSQL + PostGIS
Temps réel: Socket.IO • Redis (cache + pub/sub)
Paiements: Stripe (webhooks, 3D Secure — désactivé pour l'instant)
Auth:      JWT + Refresh tokens • bcrypt • 2FA (TOTP)
Infra:     Docker Compose (dev) • Cloud scalable (prod)
```

### Structure Monorepo - MVP
```
blobinfini/
├── apps/
│   ├── web/                 # Next.js PWA (port 3001 en dev)
│   └── api/                 # API Express modulaire (port 4000)
│       └── src/
│           └── modules/
│               ├── auth/    # 🔐 Module authentification
│               ├── users/   # Profils riders/pros
│               ├── matching/# Algorithme matching
│               ├── bookings/# Réservations
│               ├── payments/# Stripe integration (mise en pause)
│               ├── messaging/# Chat Socket.io
│               └── blobosphere/# Contenus éditoriaux & partage social
├── packages/
│   ├── database/            # Prisma schemas + client
│   ├── shared/              # Types TypeScript partagés
│   └── ui/                  # Composants réutilisables
├── docker-compose.yml       # PostgreSQL + Redis + services
├── .env.example             # Variables requises
└── turbo.json              # Config Turborepo
```

## 🚀 Commandes Essentielles

```bash
# Installation initiale
npm install
cp .env.example .env        # Configurer les variables locales

# Développement
docker compose up -d        # PostgreSQL + Redis
npm run dev:all             # API (4000) + Web (3002)
npm run dev:api             # API seule
npm run dev:web             # Frontend Next.js seul

# Base de données
npm run db:migrate          # Applique les migrations Prisma
npm run db:seed             # Charge les données de test
npm run db:reset            # Drop + migrate + seed
npm run db:reseed           # Reseed rapide sans drop complet
npm run db:studio           # Interface Prisma Studio

# Qualité & build
npm run test                # Suite Jest
npm run lint                # ESLint + formatting
npm run build               # Build de production
npm run type-check          # Vérification TypeScript stricte
```

## 🔐 Module Authentification

### Structure
```
modules/auth/
├── auth.controller.ts      # Routes API
├── auth.service.ts         # Logique métier
├── auth.guard.ts           # Middleware protection
├── strategies/
│   ├── jwt.strategy.ts     # Validation JWT
│   └── local.strategy.ts   # Email/password
└── dto/
    ├── register.dto.ts     # Validation Zod inscription
    └── login.dto.ts        # Validation Zod connexion
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

## 🔒 Règles de Sécurité CRITIQUES

### RGPD & Données
- ✅ Chiffrer TOUTES les données personnelles sensibles
- ✅ Implémenter droit à l'oubli (soft delete + purge 30j)
- ✅ Logs anonymisés après 30 jours
- ✅ Consentement explicite pour géolocalisation

### Sécurité Code
- ✅ Validation Zod sur TOUS les inputs
- ✅ Requêtes SQL via Prisma (jamais raw)
- ✅ Rate limiting sur toutes les routes
- ✅ CSRF tokens sur mutations
- ✅ Headers sécurité (CSP, HSTS, etc.)
- ✅ JWT access token (15min) + refresh token (30j)
- ✅ 2FA obligatoire pour pros

### Anti-contournement Commission
- ✅ Filtrer numéros/emails dans messages
- ✅ QR codes uniques par session
- ✅ Tracking comportements suspects

## 🌐 Module Blobosphère

### Mission
- Renforcer la visibilité de Blobinfini (SEO + réseaux sociaux) via un hub éditorial riche.
- Relier les univers Riders et Pros à un espace de contenus inspirants/experts.
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
- Modèles Prisma clés : `BlobospherePost`, `BlobosphereTopic`, `BlobosphereShareStats`.
- Statuts : `DRAFT`, `REVIEW`, `PUBLISHED`, `ARCHIVED`.
- Stockage médias : S3/MinIO via package `blobinfini/storage`, génération de vignettes.

### Gouvernance & analytics
- Rôles : `ADMIN` (publication/modération), `EDITOR` (optionnel futur), utilisateur authentifié (lecture, commentaires ultérieurs).
- Events : `blobosphere.enter`, `blobosphere.share.click`, `blobosphere.post.publish`.
- KPI : +20 % trafic organique, +10 % inscriptions issues des partages.

### Scalabilité
- Reste dans ce monorepo (Next.js + Express + Prisma). Pas de microservice tant que charge < 10k RPM soutenus.
- Plan d’évolution : CDN agressif + service de lecture read-only si trafic média massif.

## 💻 Patterns de Code

### Module Auth Type
```typescript
// modules/auth/auth.service.ts
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '@blobinfini/database';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).regex(/[A-Z]/).regex(/[0-9]/),
  role: z.enum(['RIDER', 'PRO']),
  consent: z.boolean().refine(v => v === true)
});

export class AuthService {
  async register(data: unknown) {
    const validated = registerSchema.parse(data);
    const hashedPassword = await bcrypt.hash(validated.password, 12);
    
    const user = await prisma.user.create({
      data: {
        email: validated.email,
        password: hashedPassword,
        role: validated.role,
        consentedAt: new Date()
      }
    });
    
    // Envoyer email verification
    await this.sendVerificationEmail(user);
    
    return { message: 'Check email to verify' };
  }
  
  async login(email: string, password: string) {
    const user = await this.validateCredentials(email, password);
    
    if (user.twoFactorEnabled) {
      return { requiresTwoFactor: true };
    }
    
    return this.generateTokens(user);
  }
}
```

### API Route Protégée
```typescript
// modules/bookings/bookings.controller.ts
import { requireAuth } from '@/modules/auth/auth.guard';
import { rateLimit } from '@/middleware/rate-limit';

router.post('/bookings',
  requireAuth,              // Vérifie JWT
  requireRole('RIDER'),     // Vérifie rôle
  rateLimit(100),          // 100 req/min
  validateBody(bookingSchema),
  async (req, res) => {
    const booking = await bookingService.create({
      userId: req.user.id,
      ...req.body
    });
    
    // Notification Socket.IO
    io.to(`user:${booking.proId}`).emit('new-booking', booking);
    
    res.json(booking);
  }
);
```

### Composant React Type
```tsx
// components/booking/BookingCard.tsx
'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import type { Booking } from '@blobinfini/database';

interface BookingCardProps {
  booking: Booking;
  onUpdate?: (booking: Booking) => void;
}

export function BookingCard({ booking, onUpdate }: BookingCardProps) {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  
  // Logique RGPD : masquer données sensibles
  const displayEmail = booking.user.email.replace(/(.{2}).*(@.*)/, '$1***$2');
  
  // Gestion erreurs avec toast
  // Optimistic updates
}
```

## 🚨 Points d'attention

- Après changements de schéma : exécuter `npx prisma db push`, puis `npm run build && npm run type-check`.
- Relancer un seed (`npm run db:reseed`) quand les données de référence évoluent.
- Surveiller les serveurs dev (`npm run dev:all`) ouverts en arrière-plan : consulter les logs Docker en cas d'anomalie.
- Maintenir la cohérence RGPD : consentements enregistrés, anonymisation des logs à 30 jours.

## 🔄 Workflow type pour modifications

1. Modifier le schéma Prisma si nécessaire.
2. `npx prisma db push` pour synchroniser la base locale.
3. Mettre à jour controllers/services + DTO/tests liés.
4. Corriger les tests existants et en ajouter de nouveaux.
5. `npm run build && npm run type-check` pour sécuriser la livraison.
6. `npm run db:reseed` si des données de démonstration supplémentaires sont requises.

## 🎯 Fonctionnalités Prioritaires

### Phase 1 - MVP (Actuel)
- [x] Setup monorepo Turborepo
- [ ] Module auth complet (JWT, 2FA, reset)
- [ ] Profils riders/pros avec validation
- [ ] Matching géolocalisé simple
- [ ] Réservation + paiement Stripe _(en pause)_
- [ ] Chat basique Socket.IO

### Phase 2 - Croissance
- [ ] Social login (Google, Facebook)
- [ ] Algorithme matching ML
- [ ] PWA offline-first
- [ ] Système de réputation
- [ ] Programme fidélité

### Phase 3 - Scale
- [ ] Migration vers microservices
- [ ] Multi-sports (windsurf, paddle)
- [ ] API publique
- [ ] Mascotte IA (chatbot)
- [ ] Internationalisation

## 🐛 Debug & Monitoring

```bash
# Logs temps réel
docker logs -f blobinfini-api
docker logs -f blobinfini-postgres

# Monitoring BDD
npm run db:studio

# Analyse bundle
npm run analyze

# Tests spécifiques
npm test -- --watch auth.test.ts
```

## 📝 Conventions

### Git
- Commits: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`
- Branches: `feature/nom`, `fix/nom`, `hotfix/nom`
- PR obligatoire + review avant merge

### Code
- TypeScript strict mode
- Pas de `any`, utiliser `unknown`
- Tests min 80% coverage
- Commentaires en français OK
- Noms variables/fonctions en anglais

### Base de données
- Migrations versionnées
- Seed data pour dev
- Backup quotidien prod
- Index sur géoloc + dates

## ⚡ Optimisations Performance

- Images: WebP + lazy loading + CDN
- Cache: Redis 24h pour listes pros/spots
- DB: Index composites sur requêtes fréquentes
- API: Pagination cursor-based (pas offset)
- React: Memo sur composants lourds
- Auth: JWT court (15min) + refresh long (30j)

## 🔗 Ressources Clés

- [Stripe Docs](https://stripe.com/docs)
- [PostGIS Spatial](https://postgis.net/docs/)
- [Socket.IO Rooms](https://socket.io/docs/v4/rooms/)
- [Prisma Relations](https://www.prisma.io/docs/concepts/components/prisma-schema/relations)
- [JWT Best Practices](https://datatracker.ietf.org/doc/html/rfc8725)

## 🤖 Configuration MCP pour les IA

### Serveurs MCP Disponibles

Le projet utilise **Model Context Protocol (MCP)** pour enrichir les capacités des IA. Deux configurations distinctes :

#### 1. Claude Code (CLI) - `~/.config/claude-code/mcp.json`

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
    }
  }
}
```

**Utilisation** :
- **Vercel MCP** : Gestion déploiements frontend (logs, domaines, projets)
- **Chrome DevTools MCP** : Tests navigateur, debugging, screenshots, performance

#### 2. Claude Desktop (App) - `~/.config/claude/claude_desktop_config.json`

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

**Utilisation** :
- **Sentry** : Analyse erreurs production, stack traces, rapports bugs
- **Playwright** : Tests E2E automatisés, génération scripts
- **Chrome DevTools (Puppeteer)** : Navigation web, inspection DOM
- **Context7** : Recherche documentation technique, exemples code
- **GitHub** : Gestion issues/PRs, recherche code, historique

### Configuration des Tokens

Voir `docs/mcp-setup.md` pour obtenir les tokens :
- **Sentry** : https://sentry.io/settings/account/api/auth-tokens/
- **GitHub** : https://github.com/settings/tokens (scopes: `repo`, `read:org`, `workflow`)
- **Context7** : https://context7.com
- **Vercel** : https://vercel.com/account/tokens

### Utilisation MCP dans vos tâches

Les IA peuvent désormais :
- Analyser les erreurs Sentry en production
- Générer des tests Playwright basés sur user stories
- Rechercher de la documentation via Context7
- Créer des issues GitHub ou analyser le code
- Gérer les déploiements Vercel
- Déboguer le frontend avec Chrome DevTools

## 🤖 Pour Claude/LLMs

Quand tu génères du code pour Blobinfini :
1. **Reste dans ce repo** : Ne fais référence qu'au code présent ici.
2. **Utilise les MCP** : Exploite Sentry, GitHub, Playwright, Context7, Chrome DevTools pour enrichir ton analyse.
3. **Renforce la Blobosphère** : contenus shareables, SEO, workflow admin.
4. **Module auth d'abord** : JWT, 2FA, sessions Redis
5. **Sécurité systématique** : Valide tout avec Zod
6. **RGPD strict** : Consentements, anonymisation
7. **Performance** : Cache Redis, index DB
8. **UX mobile** : Touch-friendly, offline-first
9. **Commission protégée** : Filtrage contacts
10. **Tests inclus** : Au moins un test par fonction
11. **Accessibilité** : WCAG 2.1 AA minimum

### Contexte métier clé
- Matching : Multi-critères, max 4 riders/groupe, géoloc PostGIS
- Paiement : Stripe uniquement, 3D Secure, commission 10-15% (désactivé temporairement)
- Social : Messages filtrés, groupes verrouillables
- Auth : JWT 15min + refresh 30j, 2FA pros obligatoire

### Rôles Claude Code
- Impl rapide: `ai/personas/yolo.md` + `ai/prompts/yolo_task.md`.
- Débogage/Triage: `ai/personas/debugger.md` + `ai/prompts/debug_request.md`.
- Revue PR: `ai/personas/relecteur_pr.md` + `ai/prompts/review.md`.
- Tests: `ai/personas/testeur.md` + `ai/prompts/tests.md`.
- Performance: `ai/personas/performance.md` + `ai/prompts/perf_request.md`.
- Migrations/DB: `ai/personas/migrations_db.md` + `ai/prompts/migration_plan.md`.
- Docs/DX: `ai/personas/docs_scribe.md` + `ai/prompts/docs_request.md`.

### Utilisation VS Code (Claude Code)
- Créez un profil par rôle en collant le contenu du persona dans les « System Instructions ».
- Utilisez le template associé pour formuler la demande et collez les extraits pertinents.
- Voir le protocole: `ai/handbook/claude_code_handshake.md`.

### Boîte aux lettres d’échange
- Dossiers: `ai/exchange/requests/` (demandes) et `ai/exchange/proposals/` (propositions).
- Claude Code dépose des `.diff`/`.md` dans `proposals/`; Codex applique/valide et renvoie feedback.
## 👥 Rôles & Profils (Rider/Pro)

- RiderProfile
  - Champs clés: `displayName`, `sex`, `lat/lng`, `wantsLesson` (bool), `lessonSport` ('surf'|'kitesurf').
  - Badge “🎓 Cours” en matching si `wantsLesson=true` (visible sur cartes et résultats).

- ProProfile
  - Champs clés: `businessName`, `bio`, `photoUrl`, `lat/lng` (lieu de travail), `verified` (bool).
  - `pricePerHour` conservé en base mais non exposé dans l’UI publique pour l’instant.

### BloboMap (Pros)
- Front: `/pro/map` (Leaflet + OpenStreetMap, gratuit). Filtres: sport (surf/kite) et rayon (km).
- API: `GET /pro/near/lessons?sport=surf|kitesurf&radiusKm=25` → riders avec `wantsLesson=true`, `lessonSport`=sport, coords présentes, au moins un match actif, triés par distance.
- Action “Contacter”: `POST /conversations/open` ouvre/crée une conversation directe, puis redirection vers `/messages/{id}`.
- Page `/pro/profile`: renseigner lat/lng + logo (sinon la carte affiche un message invitant à compléter le profil).

### Matching (Rider)
- Page `/matching`: interrupteur “Je veux un cours avec un pro” → met `wantsLesson=true` et `lessonSport` selon le sport choisi; bouton dédié “Faire appel à un pro”.
- Résultats/cartes: badge “🎓 Cours” sur les profils qui souhaitent un cours.

### Seeds & Commandes utiles
- `npm run db:seed` → injecte tous les comptes de démo.
- `npm run db:reseed` → efface les données non critiques puis réapplique le seed (rapide).
- `npm run db:reset` → drop + migrate + seed complet (à utiliser après évolution de schéma).

**Comptes après `npm run db:seed`**
- 20 riders : `dev+rider1@test.com` → `dev+rider20@test.com`
- 5 pros : `dev+pro1@test.com` → `dev+pro5@test.com`
- 1 admin : `dev+admin@test.com`
- Mot de passe commun : `Passw0rd!`
- Profils rapides : Rider surf (`dev+rider@test.com`), Rider kite (`dev+kite@test.com`), Pro (`dev+pro@test.com`)

### Cartographie
- Leaflet + tuiles OpenStreetMap (aucune dépendance payante). Géocodage (Nominatim) possible en extension.
