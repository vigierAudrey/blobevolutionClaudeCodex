# 🏄 Blobinfini – Monorepo IA

## 📋 Mission pour l'IA

Ce monorepo contient la version vivante de Blobinfini, marketplace de mise en relation pour les sports de glisse (surf/kitesurf).

**Votre mission** : Contribuer directement ici. Ignorez l'ancien projet `/blobevolution` (archivé). Pour un rappel historique uniquement, consultez `ai/context/migration_from_blobevolution.md`.

**Référence IA** : Ce README et `claude.md` sont les guides officiels pour nos IA (Codex, ChatGPT-5, Claude Code) et l’équipe humaine.

**Focus stratégique** : La Blobosphère est l’outil clé pour amplifier la visibilité de Blobinfini via du contenu partageable (SEO + réseaux sociaux).

## 🎯 Vision Produit

Blobinfini connecte les passionnés de sports de glisse en proposant :

- **Matching intelligent** entre riders basé sur géolocalisation, niveau et disponibilités
- **Réservation de cours** avec moniteurs professionnels certifiés
- **Paiement sécurisé** via Stripe avec commission plateforme (10-15%)
- **Messagerie intégrée** avec filtrage anti-contournement
- **Gamification** : Points "Flocons d'avoine", badges, mascotte Blob personnalisable
- **Carte interactive** (BloboMap) montrant groupes et spots en temps réel
- **Blobosphère éditoriale** pour publier articles/photos et renforcer la visibilité de Blobinfini

### Utilisateurs cibles

- **Riders** : Surfeurs/kitesurfeurs 25-45 ans cherchant partenaires ou cours
- **Professionnels** : Moniteurs indépendants et écoles cherchant visibilité
- **Objectif inclusion** : Interface accessible, effort particulier pour attirer les femmes dans ces sports

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
  - Stripe (paiements + 3D Secure)
  - Twilio (SMS/2FA)
  - Google Maps / OpenStreetMap
  - Firebase (notifications push)

Infrastructure:
  - Docker Compose (dev)
  - Cloud scalable (AWS/GCP)
  - CI/CD GitHub Actions
```

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
│       │   │   ├── payments/   # Intégration Stripe
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
└── CLAUDE.md                   # Guide IA
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

### Fonctionnalités Auth Requises

- ✅ Registration avec vérification email
- ✅ Login JWT + Refresh tokens
- ✅ 2FA obligatoire pour pros (TOTP)
- ✅ Social login (Google, Facebook)
- ✅ Reset password sécurisé
- ✅ Sessions multi-devices
- ✅ Logout avec invalidation tokens
- ✅ RGPD: consentement, export, suppression

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

## 🔒 Exigences Critiques de Sécurité

### RGPD Obligatoire

- ✅ Chiffrement AES-256 données personnelles
- ✅ Consentement explicite géolocalisation
- ✅ Droit à l'oubli (soft delete + purge 30j)
- ✅ Export données utilisateur (GDPR)
- ✅ Logs anonymisés après 30 jours
- ✅ Hébergement données en Europe

### Sécurité Technique

- ✅ Validation Zod sur TOUS les inputs
- ✅ Prisma ORM (pas de SQL raw)
- ✅ Rate limiting (100 req/min)
- ✅ CSRF tokens obligatoires
- ✅ Headers sécurité (CSP, HSTS)
- ✅ 2FA obligatoire pour pros
- ✅ JWT + refresh tokens sécurisés

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

## 📊 Fonctionnalités par Phase

### Phase 1 - MVP (3 mois)

- [ ] **Auth Module** : inscription, connexion, JWT, reset password
- [ ] **Blobosphère MVP** : listing public, article, partage social, back-office admin

### Administration – Analytics (à venir)

- **Lot 3 – Heatmap géographique** : agrégations par grille (0,1°) des recherches et premiers matches avec filtres (période, sport, niveau) et affichage heatmap dans `/admin/analytics`.
- **Lot 4 – Créneaux horaires** : distribution des décisions/matches par heure (0–23) avec double série accept/refus et visualisation (bar chart) sur la même page.

### UX – Réservation Riders ↔ Pros (à venir)

- **Parcours rider** : sélection sport/niveau, géolocalisation + distance, liste de pros disponibles, aperçu des riders déjà inscrits (miniatures), demande envoyée au pro, navigation retour simple.
- **Module planning pro** : création de créneaux (date/heure/durée/capacité), vue calendrier, gestion des demandes entrantes (accepter/refuser puis ajout du rider au créneau).
- **Workflow notification** : envoi d’une demande au pro, visualisation « en attente », acceptation → rider ajouté au créneau et miniatures mises à jour.
- **UX** : carte + liste responsive, modales profil, états vides clairs, accessibilité clavier + mobile.

#### Prochaines étapes courtes (à prioriser demain)

    - [x] Mettre en place l’infrastructure Playwright : `playwright.config.ts`, script `npm run test:e2e`, tests smoke `/reservations/start`, exécuter `npx playwright install`.
- [x] Ajuster le bouton carte « Contacter » côté rider (libellé explicite “Demander ce créneau”, tooltip) et vérifier les états désactivés.
- [x] Affiner l’expérience carte : zoom/centrage dynamique selon `distanceKm`, gestion tooltip légende sur mobile.
- [x] Documenter dans le README le lancement des tests E2E dès que Playwright est prêt.

### Administration – Analytics (à venir)

- **Lot 3 – Heatmap géographique** : agrégations par grille (0,1°) des recherches et premiers matches avec filtres (période, sport, niveau) et affichage heatmap dans `/admin/analytics`.
- **Lot 4 – Créneaux horaires** : distribution des décisions/matches par heure (0–23) avec double série accept/refus et visualisation (bar chart) sur la même page.
- [ ] Profils riders/pros avec vérification
- [ ] Matching basique par géolocalisation
- [ ] Réservation simple + paiement Stripe
- [ ] Chat 1-to-1 basique
- [ ] PWA mobile-first

### Phase 2 - Croissance (6 mois)

- [ ] **2FA obligatoire** pour pros
- [ ] Social login (Google, Facebook)
- [ ] Matching ML multi-critères
- [ ] Groupes jusqu'à 4 riders
- [ ] Système réputation (notes/avis)
- [ ] Programme fidélité (Flocons)
- [ ] BloboMap interactive
- [ ] Mascotte Blob basique
- [ ] Blobosphère enrichie (commentaires, newsletters, automation)

### Phase 3 - Scale (12 mois)

- [ ] **Migration auth vers service dédié**
- [ ] Multi-sports (windsurf, paddle)
- [ ] API publique REST/GraphQL
- [ ] Chatbot IA (Blobot)
- [ ] Camps/stages réservables
- [ ] Marketplace équipement
- [ ] Internationalisation

## 🚀 Instructions pour l'IA

### Lignes directrices

- Travaillez exclusivement dans `blobevolutionClaudeCodex`.
- Respectez l’architecture modulaire (auth, matching, bookings, payments, messaging).
- Intégrez le module `blobosphere` (contenus éditoriaux) pour renforcer la visibilité externe.
- Sécurité systématique : Zod sur tous les inputs, Prisma uniquement, rate limiting, CSRF, headers de sécurité.
- Auth : JWT 15 min + refresh 30 j, 2FA obligatoire pour les pros, sessions invalidables.
- RGPD : consentement explicite, anonymisation, droit à l’oubli, export des données.
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
# Installation
git clone [repo]
cd blobevolutionClaudeCodex
npm install

# Setup environnement
cp .env.example .env
docker compose up -d  # PostgreSQL + Redis

# Base de données
npm run db:generate   # Génère client Prisma
npm run db:migrate    # Applique migrations
npm run db:seed       # Données de test (users de démo)
npm run db:reset      # Drop + remigre + seed (RESET complet)
npm run db:reset:seedless  # Drop + remigre (sans seed)
npm run db:reseed     # Efface les données et réinjecte le jeu de démo (sans toucher au schéma)

# Développement
npm run dev           # Lance tous les services
npm run dev:web       # Frontend seulement
npm run dev:api       # API seulement

# Tests & Qualité
npm run test          # Tests unitaires
npm run test:e2e      # Tests E2E
npm run lint          # ESLint + Prettier
npm run type-check    # TypeScript

# Production
npm run build         # Build production
npm run start         # Start production
```

### Tests E2E Playwright (à lancer localement)

1. Première fois uniquement : `npx playwright install` (télécharge les navigateurs).
2. Dans un terminal séparé, démarre l’API si nécessaire (`npm run dev:api`) ; le front est lancé automatiquement par Playwright via `playwright.config.ts`.
3. Exécute `npm run test:e2e`.
4. Pour vérifier un test mobile spécifique, force l’option `--project=chromium` (déjà par défaut) ; les tests incluent une couverture mobile et la démo `/reservations/start`.
5. En CI, récupère l’artefact `playwright-report` (HTML) ou `playwright-traces` (si échec) pour rejouer les scénarios via `npx playwright show-trace <trace.zip>`.

### Publier ton travail sur GitHub (workflow local)

```bash
# Vérifier l’état
git status

# Créer une branche dédiée (une fois)
git checkout -b feat/ma-fonctionnalite

# Ajouter les fichiers modifiés
git add .

# Committer avec un message clair
git commit -m "feat: description courte"

# Pousser la branche vers GitHub
git push -u origin feat/ma-fonctionnalite
```

Ensuite, ouvre la Pull Request depuis GitHub comme d’habitude (la branche est déjà publiée).

## 🛠️ CI & E2E (Coach pédago)

- Image mentale: la **CI** est la chaîne de montage; les **E2E** sont l’essai routier filmé. Chaque PR passe la chaîne; si tout est vert, on peut fusionner en confiance.
- Ce repo possède une CI GitHub Actions: build Web, Prisma generate/migrate, type-check, tests API E2E.
- Guide détaillé avec blocs à coller: `docs/ci-e2e.md`.

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
- Riders (particuliers):
  - Profil `RiderProfile` avec `wantsLesson` (bool) et `lessonSport` (surf|kitesurf).
  - Matching: bouton "Faire appel à un pro" et interrupteur "Je veux un cours".
  - Affichage badge "🎓 Cours" sur cartes/résultats si `wantsLesson=true`.

- Pros (professionnels):
  - Profil `ProProfile` (nom commercial, bio, photo/logo, lieu de travail lat/lng, `verified`).
  - Prix conservé en base mais non exposé en UI publique pour l’instant.
  - BloboMap (OSM/Leaflet) côté pro: `/pro/map` avec filtres “Surf / Kitesurf” et rayon (km).
  - Un clic sur un marqueur ouvre/crée une conversation (“Contacter”).

- API liées:
  - `PUT /profile/me`: accepte `wantsLesson`, `lessonSport` (rider).
  - `GET /pro/near/lessons?sport=surf|kitesurf&radiusKm=25`: demandes de cours visibles par tous les pros du périmètre (variante B), Riders ayant au moins un match actif, tri par distance.
  - `POST /conversations/open`: crée/retourne une conversation directe entre 2 users.

- Web:
  - `/matching` → interrupteur “Je veux un cours” + badge 🎓 en liste.
  - `/pro/profile` → lieu de travail (lat/lng), logo; pas de champ prix en UI publique.
  - `/pro/map` → Leaflet + OpenStreetMap, filtres sport/rayon, bouton “Contacter”.

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
  npm run dev:api
  npm run dev:web
  ```

  - API dispo sur `http://localhost:4000`
  - Front web sur `http://localhost:3002`
  - Mailpit (inbox mails dev) : `http://localhost:8025`
  - Console fichier MinIO (stockage images) : `http://localhost:9001` (`minioadmin` / `minioadmin`)

- Comptes:
  - Rider: `dev+rider@test.com` (Passw0rd!) — wantsLesson surf (lat/lng Paris)
  - Rider kite: `dev+kite@test.com` (Passw0rd!) — wantsLesson kitesurf (lat/lng Paris)
  - Pro: `dev+pro@test.com` (Passw0rd!) — lieu de travail (lat/lng Paris)
  - Admin: `admin@example.com` (AdminPass123!) — accès publication/modération Blobosphère

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

### Paiement & Commission

- Stripe Connect pour split payments
- Commission 10-15% prélevée automatiquement
- Escrow virtuel jusqu'à validation session
- Remboursement automatique si annulation -24h
- Webhooks Stripe sécurisés

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
