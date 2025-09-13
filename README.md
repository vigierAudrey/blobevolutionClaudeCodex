# 🏄 Blobinfini - Claude Codex Edition

## 📋 Mission pour l'IA

Ce projet est une **refonte complète** de Blobinfini, marketplace de mise en relation pour les sports de glisse (surf/kitesurf).

**Votre mission** : Analyser le code existant dans `/blobevolution` et le réécrire avec une architecture moderne et scalable dans `/blobevolutionClaudeCodex`.

### Projets à analyser

- **Source** : `/blobevolution` (version initiale, à améliorer)
- **Destination** : `/blobevolutionClaudeCodex` (nouvelle version optimisée)

## 🎯 Vision Produit

Blobinfini connecte les passionnés de sports de glisse en proposant :

- **Matching intelligent** entre riders basé sur géolocalisation, niveau et disponibilités
- **Réservation de cours** avec moniteurs professionnels certifiés
- **Paiement sécurisé** via Stripe avec commission plateforme (10-15%)
- **Messagerie intégrée** avec filtrage anti-contournement
- **Gamification** : Points "Flocons d'avoine", badges, mascotte Blob personnalisable
- **Carte interactive** (BloboMap) montrant groupes et spots en temps réel

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
│       │   │   └── messaging/  # Chat Socket.io
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

### Phase 3 - Scale (12 mois)

- [ ] **Migration auth vers service dédié**
- [ ] Multi-sports (windsurf, paddle)
- [ ] API publique REST/GraphQL
- [ ] Chatbot IA (Blobot)
- [ ] Camps/stages réservables
- [ ] Marketplace équipement
- [ ] Internationalisation

## 🚀 Instructions pour l'IA

### Analyse du Code Existant

1. **Examinez `/blobevolution`** pour comprendre :

   - L'architecture actuelle
   - Les fonctionnalités implémentées
   - Les problèmes de sécurité
   - Les anti-patterns à corriger

2. **Identifiez les améliorations** :
   - Code non typé → TypeScript strict
   - Pas de validation → Zod partout
   - SQL direct → Prisma ORM
   - Monolithe → Modules découplés
   - Pas de tests → 80% coverage minimum
   - Auth basique → JWT + 2FA + RGPD

### Réécriture dans `/blobevolutionClaudeCodex`

3. **Créez la nouvelle architecture** :

   ```bash
   # Structure monorepo avec Turborepo
   npx create-turbo@latest blobevolutionClaudeCodex
   ```

4. **Implémentez le module Auth en premier** :

   - JWT avec access + refresh tokens
   - Validation Zod des inputs
   - Sessions Redis pour invalidation
   - 2FA avec speakeasy/otplib
   - Email verification avec nodemailer

5. **Migrez fonctionnalité par fonctionnalité** :

   - Auth → Module complet avec guards
   - Profiles → RGPD compliant avec chiffrement
   - Matching → Algorithme PostGIS optimisé
   - Booking → Intégration Stripe complète
   - Chat → Socket.io avec rooms

6. **Ajoutez les améliorations** :
   - Tests unitaires/E2E (Jest + Cypress)
   - Documentation OpenAPI
   - Monitoring (Sentry)
   - Analytics respectueux (Plausible)
   - CI/CD complet

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
npm run db:seed       # Données de test

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

## 🛠️ CI & E2E (Coach pédago)

- Image mentale: la **CI** est la chaîne de montage; les **E2E** sont l’essai routier filmé. Chaque PR passe la chaîne; si tout est vert, on peut fusionner en confiance.
- Ce repo possède une CI GitHub Actions: build Web, Prisma generate/migrate, type-check, tests API E2E.
- Guide détaillé avec blocs à coller: `docs/ci-e2e.md`.

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

Avant de coder :

1. Lisez **CLAUDE.md** pour les conventions
2. Analysez `/blobevolution` complètement
3. Proposez un plan de migration
4. **Commencez par le module Auth**
5. Validez l'architecture avec des diagrammes
6. Implémentez par petits commits atomiques

Chaque contribution doit :

- Être testée (min 80% coverage)
- Respecter TypeScript strict
- Suivre les patterns de sécurité
- Documenter les choix techniques
- Inclure les migrations nécessaires

## 📞 Support & Contact

- **Documentation** : à définir
- **Email** : blobinfini@gmail.com
- **Discord** : à définir

---

_Blobinfini - Connecter les riders, simplifier les sessions, protéger l'océan_ 🌊# blobevolutionClaudeCodex
