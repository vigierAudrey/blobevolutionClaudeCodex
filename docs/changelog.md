# 📋 Changelog - Blobinfini

Historique détaillé des changements majeurs du projet.

## Décembre 2025

### Amélioration Matching : Niveau "Peu importe" & Géolocalisation Obligatoire (16 Déc 2025)

**Fonctionnalités ajoutées** :

#### 1. Niveau "Peu importe" pour le matching

- ✅ Ajout d'une option "Peu importe" lors de la sélection du niveau (débutant/intermédiaire/confirmé)
- ✅ Filtrage intelligent :
  - Chercheur "peu importe" → voit tous les niveaux
  - Chercheur niveau spécifique → voit uniquement ce niveau
- ✅ Cohérence avec la logique de date existante

**Implémentation technique** :

```typescript
// Type Level étendu
export type Level = 'beginner' | 'intermediate' | 'advanced' | 'anytime';

// Filtrage conditionnel backend (matching.controller.ts)
const levelCond = level === 'anytime'
  ? Prisma.empty
  : Prisma.sql` AND rd."level" = ${level}`;
```

**Règles de matching** :

| Chercheur | Sport | Niveau | Date | Voit les profils |
|-----------|-------|--------|------|------------------|
| User A | Surf | **Peu importe** | Aujourd'hui | Tous les niveaux de surf disponibles aujourd'hui |
| User B | Surf | Intermediate | Peu importe | Uniquement surf/intermediate, toutes dates |
| User C | Surf | **Peu importe** | **Peu importe** | Tous les niveaux de surf, toutes dates |

#### 2. Géolocalisation obligatoire pour le matching

**Modification UX** :

- ✅ Suppression de la checkbox "Utiliser ma position" (géolocalisation toujours activée)
- ✅ Message clair : "La géolocalisation est nécessaire pour utiliser le matching"
- ✅ Bouton "Voir les profils" désactivé jusqu'à activation manuelle de la position
- ✅ Conforme RGPD : consentement explicite requis (pas d'auto-activation)

**Fichiers modifiés** :

```
apps/web/app/matching/date/page.tsx
  - Suppression de la checkbox optionnelle
  - Ajout d'un message informatif obligatoire
  - Condition stricte : disabled={!dateISO || lat == null || lng == null}

apps/api/src/modules/matching/matching.controller.ts
  - Retour de résultats vides si pas de géolocalisation (ligne 118)
  - Cohérence frontend/backend garantie
```

**Conformité RGPD** :

✅ L'utilisateur doit :
1. Cliquer manuellement sur "Activer ma position"
2. Accepter la demande du navigateur
3. Ne peut accéder au matching qu'après consentement

**Breaking changes** :

```typescript
// Avant : géolocalisation optionnelle
disabled={!dateISO || (useGeoloc && (lat == null || lng == null))}

// Après : géolocalisation obligatoire
disabled={!dateISO || lat == null || lng == null}
```

**Migration** :

Aucune migration de données nécessaire. Changement uniquement UX/logique.

---

## Novembre 2025

### Migration Prisma 6 (11 Nov 2025)

**Commit** : `718c828`

**Changements majeurs** :

- ✅ Migration complète vers Prisma 6.10.0
- ✅ Ajout extension PostGIS pour la géolocalisation
- ✅ Configuration TypeScript stricte avec `@prisma/client/runtime/library`
- ✅ Correction des imports Prisma dans tous les modules
- ✅ Mise à jour de la génération des types

**Breaking changes** :

```typescript
// Avant (Prisma 5)
import { Prisma } from '@prisma/client/runtime';

// Après (Prisma 6)
import { Prisma } from '@prisma/client/runtime/library';
```

**Migration guide** :

```bash
npm install prisma@6.10.0 @prisma/client@6.10.0
npx prisma generate
npx prisma db push
```

### GDPR Email Notifications & Rate Limiting (10 Nov 2025)

**Commit** : `05df08c`

**Fonctionnalités ajoutées** :

- ✅ Système de notifications email GDPR-compliant
- ✅ Rate limiting avancé sur toutes les routes sensibles
- ✅ Templates email transactionnels (confirmation, reset password, etc.)

**Configuration** :

```env
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=noreply@blobinfini.com
SMTP_PASSWORD=xxx
```

### Password Validation & Security Improvements (09 Nov 2025)

**Commit** : `fe97163`

**Sécurité renforcée** :

- ✅ Validation P1-3 : Mots de passe forts obligatoires (8 chars min, majuscule, chiffre, spécial)
- ✅ Rate limiting P2-5 : Protection contre brute force (10 tentatives/15min)
- ✅ Architecture Prisma optimisée (séparation client/services)

**Règles password** :

```typescript
const passwordSchema = z.string()
  .min(8, 'Minimum 8 caractères')
  .regex(/[A-Z]/, 'Au moins une majuscule')
  .regex(/[0-9]/, 'Au moins un chiffre')
  .regex(/[^A-Za-z0-9]/, 'Au moins un caractère spécial');
```

## Octobre 2025

### GDPR Export/Deletion System (28 Oct 2025)

**Commit** : `dc55056`

**Conformité RGPD** :

- ✅ Export complet des données utilisateur (JSON)
- ✅ Système de suppression de compte avec pseudonymisation
- ✅ Gestion des demandes GDPR avec workflow statut
- ✅ Audit logs pour traçabilité (conservation 5 ans)

**Endpoints ajoutés** :

```
POST /api/gdpr/export-request      # Demande export données
POST /api/gdpr/delete-request      # Demande suppression compte
GET  /api/gdpr/requests/:id        # Statut demande
```

**Délais légaux** :

- Export : 30 jours max
- Suppression : 30 jours max
- Audit logs : Conservation 5 ans

## Septembre 2025

### Push Notifications PWA - Phase 1 (20 Sept 2025)

**Architecture choisie** :

```
[Frontend PWA] ←→ [Clever Cloud API] ←→ [Firebase FCM] → [Users]
```

**Fonctionnalités** :

- ✅ Service Worker sophistiqué (`/public/sw.js`)
- ✅ PWA Manifest pour installation app-like
- ✅ Firebase Cloud Messaging intégration complète
- ✅ API routes push (`/api/push/subscribe`, `/test`, `/status`)
- ✅ Hooks React `usePushNotifications`
- ✅ Composants UI pour prompts permissions
- ✅ Notifications automatiques acceptation/refus demandes

**Variables d'environnement** :

```env
# Clever Cloud (API)
FIREBASE_PROJECT_ID=blobinfini-prod
FIREBASE_CLIENT_EMAIL=firebase-admin@...
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----..."

# Frontend (publiques)
NEXT_PUBLIC_FIREBASE_API_KEY=your-web-api-key
NEXT_PUBLIC_FIREBASE_PROJECT_ID=blobinfini-prod
```

**Avantages** :

- Clever Cloud : Hébergement français, RGPD-compliant
- Firebase FCM : Service push gratuit et universel
- Combinaison économique pour startup

### Suppression du champ `partnerPref` (15 Sept 2025)

**Décision produit** : Simplification du matching

**Changements** :

```prisma
// ❌ SUPPRIMÉ
model RiderProfile {
  partnerPref PartnerPref @default(ALL)  // Supprimé
}

enum PartnerPref {  // Enum supprimé complètement
  ALL
  WOMEN
  MEN
}

// ✅ CONSERVÉ
model RiderProfile {
  sex Sex @default(UNSPECIFIED)  // Toujours présent
}
```

**Migration** :

```bash
npx prisma db push
npm run db:reseed
```

**Impact matching** :

- Plus de filtrage par genre de partenaire
- Matching basé sur : géoloc, sport, niveau, disponibilités
- Interface simplifiée

### Affichage date sélectionnée (10 Sept 2025)

**Fonctionnalité** : Affichage de la date dans les cartes de profils

**Implémentation** :

```typescript
// Format intelligent
function formatDateForDisplay(date: string | null): string {
  if (!date) return 'Peu importe';
  const selected = new Date(date);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (isSameDay(selected, today)) return 'Aujourd\'hui';
  if (isSameDay(selected, tomorrow)) return 'Demain';

  return format(selected, 'EEE dd MMM', { locale: fr });
}
```

**Important** : La date est affichée mais **n'influence PAS** l'algorithme de matching (affichage uniquement).

## Août 2025

### Setup Monorepo Turborepo (01 Août 2025)

**Architecture initiale** :

```
blobinfini/
├── apps/
│   ├── web/                 # Next.js 14 (App Router)
│   └── api/                 # Express API
├── packages/
│   ├── database/            # Prisma schemas
│   ├── shared/              # Types partagés
│   └── ui/                  # Composants UI
├── docker-compose.yml       # PostgreSQL + Redis
└── turbo.json              # Config Turborepo
```

**Technologies** :

- Frontend : Next.js 14, TypeScript, Tailwind CSS, Shadcn/ui
- Backend : Node.js, Express, Prisma, PostgreSQL + PostGIS
- Temps réel : Socket.IO, Redis
- Auth : JWT + Refresh tokens, bcrypt, 2FA (TOTP)
- Infra : Docker Compose (dev), Clever Cloud (prod)

### Module Auth Complet (15 Août 2025)

**Fonctionnalités** :

- ✅ Inscription avec email verification
- ✅ Connexion JWT + refresh tokens
- ✅ 2FA obligatoire pour pros (TOTP)
- ✅ Reset password sécurisé
- ✅ Rate limiting anti-brute force
- ✅ Session management Redis

**Endpoints** :

```
POST /auth/register          # Inscription
POST /auth/login             # Connexion
POST /auth/refresh           # Refresh token
POST /auth/logout            # Déconnexion
POST /auth/2fa/setup         # Config 2FA
POST /auth/2fa/verify        # Validation 2FA
POST /auth/forgot-password   # Demande reset
POST /auth/reset-password    # Reset avec token
```

## Juillet 2025

### Architecture PostGIS (10 Juillet 2025)

**Géolocalisation** :

- ✅ Extension PostGIS activée
- ✅ Index GIST sur colonnes spatiales
- ✅ Requêtes optimisées ST_Distance_Sphere
- ✅ Support rayon de recherche (km)

**Exemple requête** :

```sql
SELECT *,
  ST_Distance_Sphere(
    ST_MakePoint(lng, lat),
    ST_MakePoint(:searchLng, :searchLat)
  ) / 1000 AS distance_km
FROM rider_profiles
WHERE ST_DWithin(
  ST_MakePoint(lng, lat)::geography,
  ST_MakePoint(:searchLng, :searchLat)::geography,
  :radiusMeters
)
ORDER BY distance_km;
```

## Juin 2025

### Matching Algorithm v1 (20 Juin 2025)

**Critères** :

1. **Géolocalisation** : Distance max 50km par défaut
2. **Sport** : Surf ou Kitesurf
3. **Niveau** : ±1 niveau de différence
4. **Disponibilités** : Chevauchement créneaux

**Scoring** :

```typescript
const score = (
  (100 - distance) * 0.4 +  // 40% distance
  levelMatch * 0.3 +         // 30% niveau
  availabilityMatch * 0.3    // 30% dispo
);
```

## Mai 2025

### Setup Initial (01 Mai 2025)

**Premier commit** :

- ✅ Repository créé
- ✅ Stack technique définie
- ✅ Architecture monorepo planifiée
- ✅ Documentation initiale

---

## Convention de versioning

Ce projet suit le [Semantic Versioning](https://semver.org/) :

- **MAJOR** : Breaking changes
- **MINOR** : Nouvelles fonctionnalités (backward compatible)
- **PATCH** : Bug fixes

## Branches

- `main` : Production (protected)
- `develop` : Développement actif
- `feature/*` : Nouvelles fonctionnalités
- `fix/*` : Corrections bugs
- `hotfix/*` : Correctifs urgents production

## Commits

Format : `type(scope): description`

**Types** :

- `feat` : Nouvelle fonctionnalité
- `fix` : Correction bug
- `docs` : Documentation
- `style` : Formatage (pas de changement code)
- `refactor` : Refactoring
- `test` : Ajout tests
- `chore` : Maintenance (deps, config)
- `perf` : Optimisation performance
- `security` : Correctif sécurité

**Exemples** :

```bash
feat(auth): add 2FA support for pros
fix(matching): correct distance calculation
docs(api): update OpenAPI spec for bookings
security(auth): patch JWT validation vulnerability
```
