Architecture – MVP Monorepo Blobinfini

## Structure projet (RÉELLE)

```
blobevolutionClaudeCodex/
├─ apps/
│  ├─ web/                       # Next.js 14 PWA (App Router)
│  │  ├─ app/
│  │  │  ├─ matching/           # Pages matching riders
│  │  │  ├─ pro/
│  │  │  │  ├─ dashboard/       # Dashboard pro
│  │  │  │  ├─ offers/          # ✅ Gestion offres pros (tarifs cours)
│  │  │  │  ├─ map/             # Carte riders cherchant cours
│  │  │  │  ├─ messages/        # Messagerie pro
│  │  │  │  └─ promos/          # 🆕 Promos partenaires (à venir)
│  │  │  └─ promos/             # ✅ Page publique offres partenaires (placeholder)
│  │  ├─ components/
│  │  │  ├─ ads/                # ✅ Composants publicité (AdBanner, AdPreview)
│  │  │  └─ ui/                 # shadcn/ui components
│  │  └─ lib/
│  │     └─ ads/                # ✅ Script chargement Google Adsense
│  │
│  └─ api/                       # Express API modulaire
│     └─ src/
│        ├─ modules/
│        │  ├─ admin/           # Administration
│        │  ├─ auth/            # ✅ Authentification JWT + 2FA
│        │  ├─ booking/         # ✅ Réservations & mise en relation
│        │  ├─ chat/            # ✅ Messagerie temps réel (Socket.IO)
│        │  ├─ consent/         # ✅ Consentement pub/cookies (RGPD)
│        │  ├─ contact/         # Contact/support
│        │  ├─ credits/         # Système de crédits
│        │  ├─ matching/        # ✅ Algorithme matching géolocalisé
│        │  ├─ pro/             # ✅ Gestion pros (offres, profils)
│        │  ├─ profile/         # ✅ Profils riders/pros
│        │  ├─ push/            # ✅ Notifications push (Firebase)
│        │  └─ reports/         # Signalements
│        │
│        └─ services/
│           └─ consent.service.ts  # ✅ Logique métier consentement
│
├─ packages/
│  ├─ database/                  # Prisma schema + client (PostgreSQL + PostGIS)
│  ├─ shared/                    # Types TypeScript partagés
│  └─ ui/                        # Composants UI réutilisables
│
├─ docker-compose.yml            # PostgreSQL + Redis (dev)
└─ turbo.json                    # Configuration Turborepo
```

### 📝 Notes sur la structure

**✅ Modules existants et fonctionnels**
**🆕 Pages statiques placeholder (à développer)**
**❌ Modules non créés** :
- `blobosphere/` - Hub éditorial SEO (à créer)
- `partners/` API - Gestion sponsors (à créer côté API)

## Modules clés

### Auth
- JWT access token (15min) + refresh token (30j)
- 2FA obligatoire pour pros (TOTP)
- Sessions/blacklist via Redis
- Rate limiting anti-brute force

### Matching
- **Algorithme multi-critères** :
  - Géolocalisation (PostGIS, rayon 50km par défaut)
  - Sport (surf/kitesurf)
  - Niveau (±1 niveau toléré)
  - Disponibilités

### Booking (Réservations)
- Mise en relation riders ↔ pros
- **Pas de paiement intégré** (pas de commission)
- Vérification identité pro par riders obligatoire
- QR codes supprimés (validation manuelle)
- Module : `apps/api/src/modules/booking/`

### Chat (Messagerie)
- Messagerie temps réel (Socket.IO)
- Conversations 1-to-1 riders ↔ pros
- Historique messages
- Module : `apps/api/src/modules/chat/`

### Consent (Consentement RGPD)
- Gestion consentement publicité et cookies
- Niveaux : `personalized`, `npa`, `limited`, `none`
- Storage : hash SHA-256 pseudonymisé (pas de PII)
- Purge automatique 13 mois (conformité CNIL)
- Module : `apps/api/src/modules/consent/` + `apps/api/src/services/consent.service.ts`

### Ads (Publicité) ✅
- **Frontend** : `apps/web/components/ads/` + `apps/web/lib/ads/`
- Composant `AdBanner.tsx` avec gestion RGPD
- Script `loadAdSense.ts` pour Google Adsense
- Emplacements : sidebar, feed, footer articles
- Tests E2E : `apps/web/tests/e2e/ads-consent.spec.ts`

### Pro Offers (Offres Pros) ✅
- Gestion cours par sport/niveau
- Configuration disponibilités
- API : `apps/api/src/modules/pro/`

### Promos (Offres Partenaires) 🆕
- **Page publique** : `/promos` (`apps/web/app/promos/page.tsx`)
- **Page pro** : `/pro/promos` (placeholder)
- Actuellement : page statique "Bientôt disponible"
- À développer : Marketplace sponsors surf/kite
  - Packages Bronze → Platinum
  - Codes promo exclusifs
  - Tracking analytics sponsors

### Blobosphere ❌ (À créer)
- Hub éditorial pour SEO
- Articles, galeries, interviews
- Partage social (X, Facebook, Instagram, LinkedIn)
- Statuts : DRAFT → REVIEW → PUBLISHED → ARCHIVED
- Module à créer : `apps/api/src/modules/blobosphere/`

## Stack technique

```
Frontend:  Next.js 14 (App Router) • TypeScript • Tailwind CSS • shadcn/ui • PWA
Backend:   Node.js 20+ • Express • Prisma ORM • PostgreSQL + PostGIS
Temps réel: Socket.IO • Redis (cache + pub/sub)
Auth:      JWT + Refresh tokens • bcrypt (12 rounds) • 2FA (TOTP)
Publicité: Google Adsense • Consentement RGPD
Infra:     Docker Compose (dev) • Clever Cloud (prod) 🇫🇷
```

## Sécurité (priorité absolue)

### Cross-cutting
- ✅ Validation Zod sur **tous** les inputs
- ✅ Rate limiting adaptatif (Redis)
- ✅ CSRF protection (double-submit token)
- ✅ Headers sécurité (Helmet : CSP, HSTS, etc.)
- ✅ Logs structurés anonymisés (pas de PII)
- ✅ HTTPS obligatoire (SSL/TLS)

### RGPD 🇫🇷
- ✅ Consentement explicite (cookies, géoloc, pub)
- ✅ Droit à l'oubli (soft delete + purge 30j)
- ✅ Anonymisation logs (30 jours max)
- ✅ Audit logs conservés 5 ans (obligation légale)
- ✅ Export données utilisateur (JSON)

## Modèle économique

**Association loi 1901** (gratuit pour tous) :

1. **Phase MVP** : Publicité Google Adsense
   - Consentement RGPD strict
   - Opt-out facile dans profil utilisateur
   - Revenus estimés : 50-500€/mois (M+12)

2. **Phase 2** : Sponsors surf/kite
   - Packages : Bronze (500€/an) → Platinum (5k€/an)
   - Logo homepage + articles Blobosphère
   - Dashboard analytics sponsors

3. **Phase 3** : Marketplace offres partenaires
   - Réductions exclusives membres
   - Affiliation possible (commission sur ventes)
   - Win-win : sponsors + riders

**Pas de commission** sur transactions riders ↔ pros.

## Migration path (Scale)

- **MVP** : Monorepo, Auth dans API
- **Phase 2** : Microservices si charge > 10k RPM
- **Phase 3** : Service Auth dédié, multi-sports (windsurf, paddle)

---

## 📊 Récapitulatif État des Modules

### ✅ Modules Complets et Fonctionnels

| Module | Backend | Frontend | Statut |
|--------|---------|----------|--------|
| **Auth** | `modules/auth/` | Login/Register pages | ✅ Production ready |
| **Matching** | `modules/matching/` | `/matching` pages | ✅ Production ready |
| **Booking** | `modules/booking/` | Réservation flow | ✅ Production ready |
| **Chat** | `modules/chat/` | `/messages` | ✅ Production ready |
| **Profile** | `modules/profile/` | `/profile` | ✅ Production ready |
| **Pro** | `modules/pro/` | `/pro/*` pages | ✅ Production ready |
| **Consent** | `modules/consent/` + `services/consent.service.ts` | Gestion consentement | ✅ Production ready |
| **Ads** | `services/consent.service.ts` | `components/ads/` + `lib/ads/` | ✅ Production ready |
| **Push** | `modules/push/` | Notifications | ✅ Production ready |
| **Reports** | `modules/reports/` | Signalements | ✅ Production ready |

### 🆕 Pages Statiques (Placeholder)

| Page | Chemin | Description |
|------|--------|-------------|
| **Promos publique** | `/promos` | Page "Bientôt disponible" pour offres partenaires |
| **Promos pro** | `/pro/promos` | Placeholder pour futurs sponsors |

### ❌ Modules À Créer

| Module | Backend | Frontend | Priorité |
|--------|---------|----------|----------|
| **Blobosphere** | `modules/blobosphere/` | `/blobosphere/*` | 🔴 High (SEO) |
| **Partners API** | `modules/partners/` | `/api/partners/*` | 🟡 Medium (Phase 2) |

### 🔧 Modules Techniques

| Module | Localisation | Statut |
|--------|--------------|--------|
| **Admin** | `modules/admin/` | ✅ Fonctionnel |
| **Contact** | `modules/contact/` | ✅ Fonctionnel |
| **Credits** | `modules/credits/` | ✅ Fonctionnel |

---

**Dernière mise à jour** : 07/11/2025
**Vérifié avec** : Structure réelle du projet
