# 🏄 Guide IA – Blobinfini

 Ce fichier guide nos IA (Codex, ChatGPT-5, Claude Code) dans le développement de Blobinfini. À lire avant chaque session de code.

> **Note :** ce document remplace l'ancien `CLAUDE.md`. Tous les liens internes doivent désormais pointer vers `claude.md`.

## 📌 Contexte Projet

**Blobinfini** = Marketplace communautaire pour sports de glisse (surf/kitesurf)

### Fonctionnalités clés

- **Matching** : Algorithme multi-critères (géoloc, niveau, dispo) pour connecter riders
- **Réservation** : Mise en relation riders/pros pour cours
- **Sécurité riders** : Contrôle d'identité pro obligatoire avant session
- **Social** : Messagerie temps réel, groupes, favoris, système de réputation
- **Blobosphère** : Hub éditorial SEO pour contenus communautaires
- **Modèle économique** : Association loi 1901, financée par publicité et sponsors

## 🫧 Philosophie Blobinfini

- 🌍 **Sobriété numérique** : code léger, dépendances open-source et hébergement français pour limiter l’empreinte carbone.
- 🧭 **Utilité avant tout** : chaque ligne doit améliorer l’expérience rider/pro ou simplifier l’opérationnel.
- 🕊️ **Accessibilité & inclusion** : mobile-first, contrastes respectés et parcours compatibles WCAG 2.1 AA.
- 🔐 **Éthique & RGPD** : aucun dark pattern, consentement explicite, données personnelles minimisées.
- ⚙️ **Robustesse > nouveauté** : on privilégie un MVP stable plutôt qu’une fonctionnalité inachevée.
- 🤝 **Apprentissage collectif** : commits lisibles, documentation à jour et commentaires pédagogiques lorsqu’une logique est subtile.

## 🧠 Comportement attendu des IA

### Lecture & préparation
- Lire au moins trois fichiers proches (implémentation, tests, pattern analogue) avant toute modification pour comprendre le contexte.
- Inspecter systématiquement les imports afin d’identifier DTO, services partagés et conventions typées.
- Vérifier la cohérence API ↔ UI ↔ tests (schémas OpenAPI, validations Zod, types partagés) avant de proposer un changement.

### Contributions attendues
- Suivre le workflow AGENTS : persona explicite, plan clair (>1 étape), exploration avant code, tests annoncés.
- Chaque proposition inclut une explication, une justification, un extrait cohérent et un plan de test (ou les raisons de son absence).
- Tout changement fonctionnel entraîne la mise à jour des documents concernés (README, claude.md, ROADMAP, docs/*).

### Outils & patterns obligatoires
- Valider toutes les entrées avec **Zod** côté API (DTO) et synchroniser les types partagés (`packages/database`, `apps/web/types`).
- Utiliser **Prisma** et les services existants : pas de SQL brut ni de bypass des couches métier.
- Côté frontend, passer par `apps/web/lib/apiClient.ts` (gestion CSRF, tokens, retry) au lieu de `fetch` direct.
- Réutiliser les composants **Shadcn/Tailwind** situés dans `apps/web/components/ui/*` (Button, Card, Switch, Dialog, etc.).
- Les préférences d’accessibilité (contraste, police, animations) sont centralisées dans `apps/web/components/accessibility/AccessibilityProvider`. Les layouts/pages doivent rester sous ce provider et utiliser `useAccessibility` pour exposer ou consommer ces réglages.
- Les logs passent par `secureLogger` ou les utilitaires existants, jamais `console.log` en production.

### Interdits immédiats
- Aucun secret ni donnée personnelle en clair dans le code, les fixtures ou les tests.
- Pas de cookies, tracking ou publicité sans consentement CMP explicite.
- Ne jamais supprimer une validation Zod ni affaiblir un guard de sécurité sans validation sécurité/produit.
- Pas d’ajout de champs liés au paiement/marketing sans décision produit documentée et revue RGPD.

### Support & diagnostic
- Proposer les commandes/logs/tests pertinents (ex. `npm run test`, `npm run openapi:lint`, `docker logs -f blobinfini-api`) lors d’un triage.
- Remonter immédiatement toute ambiguïté documentaire ou divergence détectée dans le code.

### Mini-règles anti-hallucinations
- Toujours citer les fichiers/références du repo utilisés comme source lorsqu’on argumente.
- Vérifier la présence réelle d’une dépendance ou d’un outil (package.json, docs) avant de l’évoquer.
- Limiter la portée des modifications et expliciter toute hypothèse ou inconnue dans la PR.
- Escalader vers l’humain quand une consigne est ambiguë ou contradictoire.

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
| `npm run storybook:test` | Validation visuelle + snapshots des composants UI (target 70% coverage frontend) |

⚠️ **Tests obligatoires avant PR** :
- Modules critiques (auth, matching, bookings, blobosphère, ads) : `npm run test` + `npm run test:e2e` + `npm run storybook:test` si composants UI modifiés.
- Pour toute modification d'un module critique, citer explicitement les commandes recommandées avant de livrer.

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
  - Vérifier la cohérence des types côté front (`apps/web/components`, `apps/web/types`) et mettre à jour la doc utilisateur si nécessaire.
- **Check PR obligatoire** : inclure dans la description la checklist Contrats/UI (OpenAPI à jour, stories/tests visuels à jour) avant demande de review.

## 🎨 Règles UI Blobinfini

- **Design system** : Tailwind + Shadcn, composants disponibles dans `apps/web/components/ui/*` (Button, Card, Switch, Dialog, Input, etc.). Pas de `<div>` ou `<button>` custom pour recréer ces patterns.
  - ⚠️ **Pas de package `packages/ui` pour le MVP** : tous les composants restent dans `apps/web/components/ui/*` tant qu'il n'y a pas de deuxième frontend (admin séparé, mobile app).
- **Formulaires** : suivre les patterns existants (`apps/web/components/AuthForm.tsx`, `components/reservations/*`).
  - **Pattern standard** : validation côté API via DTO Zod → gestion d'état locale React (useState) → appels via `apps/web/lib/apiClient.ts` → affichage erreurs UX.
  - **Pas de librairie de formulaires** pour le MVP (react-hook-form, formik). On garde le pattern simple actuel. À réévaluer si formulaires multi-étapes complexes.
- **Icônes & illustrations** : utiliser `lucide-react` exclusivement, variantes accessibles (aria-label, title).
- **Accessibilité** : focus visible, labels explicites, navigation clavier complète, sémantique respectée (role/aria). Tester via Storybook + axe.
- **Design tokens** : ne jamais hardcoder les couleurs/espaces ; puiser dans `tailwind.config.ts` et les variables CSS globales.
- **Stories & visual tests** : tout nouveau state/prop doit avoir sa story (`*.stories.tsx`) et être couvert par `npm run storybook:test` (snapshots ou visuels).

## 🔐 IA Security Contracts

- Refuser toute proposition qui stocke une donnée personnelle sans consentement explicite ou hors finalité documentée.
- Alerter si un cookie, tracking ou publicité est introduit avant consentement CMP ou sans option d’opt-out.
- Pas de champs liés au paiement ou au marketing agressif tant que le produit n’a pas validé l’usage et que la doc RGPD n’est pas mise à jour.
- Vérifier systématiquement : JWT ≥ 64 caractères, secrets en `.env`, logs via `secureLogger`, tokens persistés chiffrés.
- Aucun `console.log` en production, aucune dépendance propriétaire sans justification écrite et validation légale.
- Ces garde-fous complètent la section **🔒 Règles de Sécurité CRITIQUES** : escalader immédiatement si une demande utilisateur les contredit.

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
Auth:      JWT + Refresh tokens • bcrypt • 2FA (TOTP)
Publicité: Google Adsense • Consentement RGPD strict
Infra:     Docker Compose (dev) • Clever Cloud (prod) 🇫🇷
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
│               ├── bookings/# Réservations & mise en relation
│               ├── messaging/# Chat Socket.io
│               ├── blobosphere/# Contenus éditoriaux
│               └── ads/     # Gestion publicité & consentement
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

> ℹ️ Les comptes `ADMIN` sont provisionnés manuellement par le core team : l’API d’inscription n’accepte plus ce rôle et l’UI publique ne l’expose pas.

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

### Publicité & Consentement RGPD

**Règles strictes pour la publicité** :

```typescript
// ✅ Gestion consentement publicité
interface UserAdPreferences {
  adsEnabled: boolean;           // Opt-out possible
  personalizedAds: boolean;      // Consentement explicite requis
  adProviders: string[];         // Liste providers acceptés
  lastUpdated: Date;
}

// Interface dans profil utilisateur
function AdPreferencesSettings() {
  return (
    <Card>
      <CardTitle>🍪 Gestion de la publicité</CardTitle>
      <CardDescription>
        Blobinfini est une association gratuite financée par la publicité.
        Vous pouvez désactiver les pubs, mais cela limite nos revenus.
      </CardDescription>
      <Switch
        checked={adsEnabled}
        label="Afficher les publicités (soutenir l'association)"
      />
      <Switch
        checked={personalizedAds}
        label="Publicités personnalisées (optionnel)"
      />
    </Card>
  );
}
```

**Emplacements publicitaires** :
- Sidebar desktop (300x250)
- Entre résultats matching (tous les 10 profils)
- Footer articles Blobosphère

**JAMAIS** :
- ❌ Cookies pub avant consentement
- ❌ Publicité intrusive (popup, interstitiel)
- ❌ Saturation de l'UX (max 10% de l'espace)

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
- [x] Module auth complet (JWT, 2FA, reset)
- [x] Profils riders/pros avec validation
- [x] Matching géolocalisé
- [ ] Création association loi 1901
- [ ] Intégration Google Adsense + consentement RGPD
- [ ] Chat basique Socket.IO
- [ ] Blobosphère MVP (articles + SEO)

### Phase 2 - Sponsors & Partenaires (T2 2026)
- [ ] Page /sponsors sur le site
- [ ] Démarchage marques surf/kite (5 sponsors)
- [ ] Marketplace offres partenaires (/offres-partenaires)
- [ ] Newsletter mensuelle avec sponsors
- [ ] Social login (Google, Facebook)
- [ ] Système de réputation avancé

### Phase 3 - Pérennisation (2027+)
- [ ] Subventions publiques (DRAJES, Région)
- [ ] Événements physiques sponsorisés
- [ ] Multi-sports (windsurf, paddle, skate)
- [ ] API publique pour partenaires
- [ ] Internationalisation (Espagne, Portugal)

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
- **Tests & couverture** :
  - **API** : Min 80% coverage (`npm run test` via Jest)
  - **Frontend** : Min 70% coverage progressive (Storybook + snapshots visuels prioritaires)
  - **E2E** : Parcours critiques via Playwright (`npm run test:e2e`)
  - **Commandes clés** : `npm run test`, `npm run storybook:test`, `npm run test:e2e`
- Commentaires en français OK
- Noms variables/fonctions en anglais

### 2025-11-09 — Normalisation du nettoyage Jest & isolation des suites e2e

1. **Résumé pédagogique** – Toutes les suites end-to-end (`auth`, `conversations`, `matching`, `profile`, `admin`, `contact`, `anti-overbooking`, `booking`) reconstruisent désormais leurs fixtures dans un `beforeEach()`. Chaque test repart donc d’un état neuf et n’hérite plus des mutations du test précédent.
2. **Description technique** – Le nettoyage Jest central (`apps/api/jest.setup.db.ts`) repasse systématiquement sur toutes les tables entre les suites, sans exceptions restantes dans `skipCleanupPatterns`. Cette uniformisation stabilise la CI et prépare la bascule vers Prisma 7, où les différences de schema seront immédiatement détectées.

> 🧠 Coach pédago : imagine une gare où chaque train (suite e2e) dispose d’un mini-atelier de remise à zéro avant le départ, pendant que la grande équipe de nettoyage repasse entre chaque passage.  
> 🧭 Prochaine balade naturelle : surveiller les futures suites e2e et documenter rapidement toute nouvelle exception afin de préserver cette isolation totale.

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

### Documentation technique

- [PostGIS Spatial](https://postgis.net/docs/)
- [Socket.IO Rooms](https://socket.io/docs/v4/rooms/)
- [Prisma Relations](https://www.prisma.io/docs/concepts/components/prisma-schema/relations)
- [JWT Best Practices](https://datatracker.ietf.org/doc/html/rfc8725)
- [Google Adsense Policies](https://support.google.com/adsense/answer/48182)

### RGPD & Sécurité 🇫🇷

- [CNIL - Guide RGPD du développeur](https://www.cnil.fr/fr/guide-rgpd-du-developpeur)
- [CNIL - Cookies et traceurs](https://www.cnil.fr/fr/cookies-et-autres-traceurs)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [ANSSI - Bonnes pratiques](https://www.ssi.gouv.fr/)

### Association loi 1901

- [Service-Public - Créer une association](https://www.service-public.fr/associations/vosdroits/F1119)
- [Associations.gouv.fr - RNA](https://www.associations.gouv.fr/)
- [Légifrance - Loi 1901](https://www.legifrance.gouv.fr/loda/id/JORFTEXT000000497458/)

## 📚 Documentation Annexe Détaillée

Pour des guides approfondis, consultez le dossier `/docs` :

- **[Modèle Économique](docs/business-model.md)** ⭐ : Association, publicité, sponsors, offres partenaires
- **[Configuration MCP](docs/mcp-config.md)** : Serveurs MCP pour IA (GitHub, Sentry, Playwright, etc.)
- **[Blobosphère](docs/blobosphere.md)** : Guide complet avec focus RGPD/sécurité
- **[Changelog](docs/changelog.md)** : Historique détaillé des changements
- **[Migration Prisma 6](docs/migration-prisma6.md)** : Guide migration Prisma 5 → 6
- **[CI/E2E](docs/ci-e2e.md)** : Tests end-to-end et CI/CD
- **[Storybook](docs/storybook.md)** : Guide Storybook composants UI

## 🤖 Configuration MCP pour les IA

### Serveurs MCP Disponibles

Le projet utilise **Model Context Protocol (MCP)** pour enrichir les capacités des IA.

> 📖 **Documentation complète** : Voir [docs/mcp-config.md](docs/mcp-config.md) pour la configuration détaillée.

**Serveurs disponibles** :

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

**Utilisation** :
- **Vercel MCP** : Gestion déploiements frontend (logs, domaines, projets)
- **Chrome DevTools MCP** : Tests navigateur, debugging, screenshots, performance
- **GitHub MCP** : Recherche/écriture d’issues, PRs et historique depuis Claude Code

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
8. **UX mobile** : Touch-friendly, offline-first (PWA)
9. **Publicité éthique** : Consentement RGPD, opt-out facile, max 10% espace
10. **Tests inclus** : Au moins un test par fonction (min 80% coverage)
11. **Accessibilité** : WCAG 2.1 AA minimum

### Contexte métier clé

**Modèle économique** :
- **Association loi 1901** (gratuit pour tous)
- **Revenus** : Publicité (Google Adsense) + Sponsors surf/kite + Offres partenaires
- **Pas de commission** sur transactions
- **Pas de paiement intégré** (mise en relation uniquement)

**Fonctionnalités** :
- **Matching** : Multi-critères, max 4 riders/groupe, géoloc PostGIS
- **Social** : Messages temps réel, groupes, favoris
- **Auth** : JWT 15min + refresh 30j, 2FA pros obligatoire
- **Sécurité** : Contrôle identité pro par riders avant session

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

### RiderProfile

- **Champs clés** : `displayName`, `sex`, `lat/lng`, `wantsLesson` (bool), `lessonSport` ('surf'|'kitesurf')
- **Matching** : Préférence cours affichée dans les résultats
- **Sécurité** : Conseils contrôle identité pro avant session

### ProProfile

- **Champs clés** : `businessName`, `bio`, `photoUrl`, `lat/lng` (lieu de travail)
- **Vérification** : Badge `verified` (bool) après validation admin (SIRET, assurance, diplômes)
- **Tarification** : Affichage tarifs indicatifs (négociation directe rider/pro)

### BloboMap (Pros)
- Front: `/pro/map` (Leaflet + OpenStreetMap, gratuit). Filtres: sport (surf/kite) et rayon (km).
- API: `GET /pro/near/lessons?sport=surf|kitesurf&radiusKm=25` → riders avec `wantsLesson=true`, `lessonSport`=sport, coords présentes, au moins un match actif, triés par distance.
- Action “Contacter”: `POST /conversations/open` ouvre/crée une conversation directe, puis redirection vers `/messages/{id}`.
- Page `/pro/profile`: renseigner lat/lng + logo (sinon la carte affiche un message invitant à compléter le profil).

### Matching (Rider)

- **Page `/matching`** : Interrupteur "Je veux un cours avec un pro" → `wantsLesson=true` + `lessonSport`
- **Résultats** : Indication "Recherche cours" visible sur les profils
- **Sécurité** : Avertissement contrôle identité pro avant confirmation réservation

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
