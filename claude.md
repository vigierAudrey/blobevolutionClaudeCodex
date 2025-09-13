# 🏄 Guide Claude Code – Blobinfini

Ce fichier guide Claude (ou tout LLM) dans le développement de Blobinfini. À lire avant chaque session de code.

## 📌 Contexte Projet

**Blobinfini** = Marketplace communautaire pour sports de glisse (surf/kitesurf)
- **Matching** : Algorithme multi-critères (géoloc, niveau, dispo) pour connecter riders
- **Réservation** : Cours avec pros, paiement Stripe, QR codes validation
- **Social** : Messagerie temps réel, groupes, favoris, réputation
- **Gamification** : Points "Flocons d'avoine", badges, mascotte Blob personnalisable

## 🏗️ Architecture Technique

### Stack Principal
```
Frontend:  Next.js 14 (App Router) • TypeScript • Tailwind CSS • Shadcn/ui • PWA
Backend:   Node.js • Express • Prisma ORM • PostgreSQL + PostGIS
Temps réel: Socket.IO • Redis (cache + pub/sub)
Paiements: Stripe (webhooks, 3D Secure)
Auth:      JWT + Refresh tokens • bcrypt • 2FA (TOTP)
Infra:     Docker Compose (dev) • Cloud scalable (prod)
```

### Structure Monorepo - MVP
```
blobinfini/
├── apps/
│   ├── web/                 # Next.js PWA (port 3000)
│   └── api/                 # API Express modulaire (port 4000)
│       └── src/
│           └── modules/
│               ├── auth/    # 🔐 Module authentification
│               ├── users/   # Profils riders/pros
│               ├── matching/# Algorithme matching
│               ├── bookings/# Réservations
│               ├── payments/# Stripe integration
│               └── messaging/# Chat Socket.io
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
cp .env.example .env        # Configurer les variables

# Démarrage complet
docker compose up -d         # BDD + Redis
npm run db:migrate          # Migrations Prisma
npm run dev                 # Tous les services

# Commandes spécifiques
npm run db:studio           # Interface Prisma
npm run test               # Jest + Cypress
npm run lint               # ESLint + Prettier
npm run type-check         # TypeScript strict
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

## 🎯 Fonctionnalités Prioritaires

### Phase 1 - MVP (Actuel)
- [x] Setup monorepo Turborepo
- [ ] Module auth complet (JWT, 2FA, reset)
- [ ] Profils riders/pros avec validation
- [ ] Matching géolocalisé simple
- [ ] Réservation + paiement Stripe
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

## 🤖 Pour Claude/LLMs

Quand tu génères du code pour Blobinfini :
1. **Module auth d'abord** : JWT, 2FA, sessions Redis
2. **Sécurité systématique** : Valide tout avec Zod
3. **RGPD strict** : Consentements, anonymisation
4. **Performance** : Cache Redis, index DB
5. **UX mobile** : Touch-friendly, offline-first
6. **Commission protégée** : Filtrage contacts
7. **Tests inclus** : Au moins un test par fonction
8. **Accessibilité** : WCAG 2.1 AA minimum

### Contexte métier clé
- Matching : Multi-critères, max 4 riders/groupe, géoloc PostGIS
- Paiement : Stripe uniquement, 3D Secure, commission 10-15%
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
