# 🌐 Blobosphère - Guide Complet

La Blobosphère est le hub éditorial de Blobinfini, conçu pour renforcer la visibilité SEO et l'engagement communautaire.

> ⚠️ **IMPORTANT** : Ce module manipule des données publiques et personnelles. Le respect du RGPD et de la sécurité est **ABSOLU**.

## 📚 Table des matières

- [Vision & Mission](#vision--mission)
- [🔒 Sécurité & RGPD - PRIORITÉ ABSOLUE](#-sécurité--rgpd---priorité-absolue)
- [Architecture Technique](#architecture-technique)
- [Fonctionnalités MVP](#fonctionnalités-mvp)
- [Modèles de données](#modèles-de-données)
- [API Endpoints](#api-endpoints)
- [Frontend Components](#frontend-components)
- [Workflow Éditorial](#workflow-éditorial)
- [SEO & Partage Social](#seo--partage-social)
- [Gouvernance & Analytics](#gouvernance--analytics)
- [Roadmap](#roadmap)

## Vision & Mission

### Objectifs stratégiques

1. **Visibilité** : Renforcer la présence SEO de Blobinfini via des contenus riches
2. **Engagement** : Créer une communauté autour des sports de glisse
3. **Acquisition** : Convertir les visiteurs en utilisateurs inscrits
4. **Expertise** : Positionner Blobinfini comme référence dans les sports de glisse

### KPI cibles (6 mois)

- +20% de trafic organique
- +10% d'inscriptions via partages sociaux
- 50+ articles publiés
- 10k+ vues moyennes par article

## 🔒 Sécurité & RGPD - PRIORITÉ ABSOLUE

> **Contexte légal** : Blobinfini est une entreprise française, soumise au RGPD (Règlement Général sur la Protection des Données) et à la loi Informatique et Libertés.

### 🇫🇷 Conformité RGPD Obligatoire

#### 1. Données personnelles dans les articles

**Règles strictes** :

```typescript
// ❌ INTERDIT - Publier sans consentement
const article = {
  content: "Rencontre avec Jean Dupont, surfeur de Biarritz, email: jean@example.com"
};

// ✅ OBLIGATOIRE - Consentement explicite + anonymisation
const article = {
  content: "Rencontre avec Jean D., surfeur passionné",
  consent: {
    userId: "user_123",
    consentedAt: new Date(),
    consentType: "INTERVIEW_PUBLICATION",
    validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 an
  }
};
```

**Actions obligatoires** :

- ✅ **Consentement écrit** avant publication d'une interview/photo
- ✅ **Durée limitée** : renouvellement du consentement tous les 12 mois
- ✅ **Droit de retrait** : formulaire de demande de suppression
- ✅ **Anonymisation** : pas de noms complets, emails, téléphones dans les contenus publics
- ✅ **Mineurs** : consentement parental obligatoire (<15 ans en France)

#### 2. Cookies & Tracking Analytics

**Conformité CNIL** :

```typescript
// cookies.config.ts
export const cookieConfig = {
  essential: {
    // Exemptés de consentement
    session: { name: 'session', duration: '24h' },
    csrf: { name: 'csrf_token', duration: 'session' },
  },
  analytics: {
    // CONSENTEMENT OBLIGATOIRE
    googleAnalytics: { name: '_ga', purpose: 'Mesure audience', duration: '13 months' },
    hotjar: { name: '_hjid', purpose: 'Analyse comportement', duration: '12 months' },
  },
  advertising: {
    // CONSENTEMENT OBLIGATOIRE + opt-in explicite
    facebook: { name: '_fbp', purpose: 'Publicité ciblée', duration: '90 days' },
  },
};
```

**Implémentation obligatoire** :

```tsx
// components/CookieBanner.tsx
export function CookieBanner() {
  return (
    <div className="cookie-banner">
      <h3>🍪 Gestion des cookies</h3>
      <p>
        Nous utilisons des cookies pour améliorer votre expérience.
        <Link href="/cookies">Politique de cookies</Link>
      </p>
      <div>
        <button onClick={acceptEssential}>Cookies essentiels uniquement</button>
        <button onClick={acceptAll}>Tout accepter</button>
        <button onClick={openCustomize}>Personnaliser</button>
      </div>
    </div>
  );
}
```

#### 3. Droit à l'effacement ("Droit à l'oubli")

**Article 17 RGPD** :

```typescript
// blobosphere.service.ts
export class BlobosphereService {
  /**
   * Suppression RGPD d'un utilisateur dans les contenus Blobosphère
   * IMPORTANT: Obligatoire sous 30 jours après demande
   */
  async handleUserDeletionRequest(userId: string) {
    // 1. Identifier tous les contenus liés
    const postsAsAuthor = await prisma.blobospherePost.findMany({
      where: { authorId: userId },
    });

    // 2. Anonymiser (SOFT DELETE)
    await prisma.blobospherePost.updateMany({
      where: { authorId: userId },
      data: {
        authorId: 'DELETED_USER',
        // Conserver le contenu mais anonymiser l'auteur
      },
    });

    // 3. Supprimer les commentaires personnels
    await prisma.blobosphereComment.deleteMany({
      where: { userId },
    });

    // 4. Logger l'action (obligation légale)
    await auditLog.create({
      action: 'USER_DATA_DELETION',
      userId,
      module: 'BLOBOSPHERE',
      executedAt: new Date(),
      retentionUntil: new Date(Date.now() + 5 * 365 * 24 * 60 * 60 * 1000), // 5 ans
    });
  }
}
```

#### 4. Mentions légales & CGU

**Pages obligatoires** :

- ✅ `/mentions-legales` : Identité éditeur, hébergeur, CNIL
- ✅ `/politique-confidentialite` : Données collectées, durées conservation
- ✅ `/gestion-cookies` : Liste cookies, finalités, opt-out
- ✅ `/cgu` : Conditions générales d'utilisation

**Responsable de traitement** :

```typescript
// Legal footer data
export const legalInfo = {
  company: {
    name: 'Blobinfini SAS',
    siret: 'XXX XXX XXX XXXXX',
    address: '123 rue de la Glisse, 64200 Biarritz',
    rcs: 'Bayonne B XXX XXX XXX',
  },
  dpo: {
    // Délégué à la Protection des Données (obligatoire si > 250 salariés)
    email: 'dpo@blobinfini.com',
    role: 'Délégué à la Protection des Données',
  },
  cnil: {
    // Déclaration CNIL si nécessaire
    number: 'En cours',
    link: 'https://cnil.fr',
  },
  hosting: {
    provider: 'Hetzner VPS',
    address: 'Union europeenne',
    country: 'UE', // Hébergement européen = cadre RGPD
  },
};
```

#### 5. Modération & Signalement

**Obligation légale** (Loi contre les contenus haineux) :

```typescript
// Système de signalement obligatoire
interface ContentReport {
  postId: string;
  reportedBy: string; // Peut être anonyme
  reason: ReportReason;
  description: string;
  status: 'PENDING' | 'REVIEWED' | 'REMOVED' | 'REJECTED';
  reviewedBy?: string;
  reviewedAt?: Date;
}

enum ReportReason {
  HATE_SPEECH = 'Incitation à la haine',
  HARASSMENT = 'Harcèlement',
  PERSONAL_DATA = 'Données personnelles exposées',
  COPYRIGHT = 'Violation droits d\'auteur',
  SPAM = 'Spam ou contenu commercial abusif',
  MISINFORMATION = 'Fausse information',
  OTHER = 'Autre',
}

// Délai légal : modération sous 24h
```

#### 6. Durées de conservation des données

**Conformité CNIL** :

| Type de donnée | Durée | Base légale |
|----------------|-------|-------------|
| **Contenu publié** | Illimitée | Intérêt légitime |
| **Brouillons** | 12 mois | Consentement |
| **Analytics (vues, partages)** | 13 mois | Consentement (cookies) |
| **Logs techniques** | 12 mois | Obligation légale |
| **Logs anonymisés** | 3 ans | Statistiques |
| **Données auteur après suppression** | Anonymisé | RGPD Art. 17 |

```typescript
// Tâche CRON : Purge automatique
export async function purgeExpiredData() {
  // Supprimer les brouillons > 12 mois
  await prisma.blobospherePost.deleteMany({
    where: {
      status: 'DRAFT',
      createdAt: { lt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) },
    },
  });

  // Anonymiser les logs > 12 mois
  await anonymizeLogs({ olderThan: '12 months' });
}
```

### 🛡️ Sécurité Technique

#### 1. Validation des entrées (XSS, Injection)

```typescript
// ❌ DANGER - XSS possible
const createPost = (data: any) => {
  return `<div>${data.content}</div>`; // USER INPUT NON SANITIZED
};

// ✅ OBLIGATOIRE - Sanitization stricte
import DOMPurify from 'isomorphic-dompurify';
import { z } from 'zod';

const postSchema = z.object({
  title: z.string().min(3).max(200).regex(/^[^<>]*$/), // Pas de HTML
  content: z.string().min(100).max(50000),
  excerpt: z.string().max(300),
});

const createPost = (data: unknown) => {
  const validated = postSchema.parse(data);

  // Sanitize HTML content
  const sanitizedContent = DOMPurify.sanitize(validated.content, {
    ALLOWED_TAGS: ['p', 'b', 'i', 'u', 'a', 'img', 'h2', 'h3', 'ul', 'ol', 'li'],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title'],
  });

  return prisma.blobospherePost.create({
    data: { ...validated, content: sanitizedContent },
  });
};
```

#### 2. Rate Limiting (Protection DDoS)

```typescript
// Rate limiting stricte sur toutes les routes
import rateLimit from 'express-rate-limit';

// Routes publiques
const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requêtes max
  message: 'Trop de requêtes, veuillez réessayer plus tard.',
});

// Routes admin (plus restrictif)
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: 'Limite atteinte pour les actions admin.',
});

// Upload médias (très restrictif)
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 heure
  max: 20, // 20 uploads max/heure
  message: 'Limite d\'uploads atteinte.',
});

app.use('/api/blobosphere', publicLimiter);
app.use('/api/admin/blobosphere', adminLimiter);
app.use('/api/admin/blobosphere/media', uploadLimiter);
```

#### 3. Authentification & Autorisation

```typescript
// Middleware de protection obligatoire
import { requireAuth, requireRole } from '@/middleware/auth';

// Routes publiques (lecture seule)
router.get('/posts', publicLimiter, getPosts);
router.get('/posts/:slug', publicLimiter, getPost);

// Routes admin PROTÉGÉES
router.post('/admin/posts',
  adminLimiter,
  requireAuth,              // JWT valide
  requireRole('ADMIN'),     // Rôle ADMIN obligatoire
  validateCSRF,             // Protection CSRF
  validateBody(postSchema), // Validation Zod
  createPost
);

router.put('/admin/posts/:id',
  adminLimiter,
  requireAuth,
  requireRole('ADMIN'),
  validateCSRF,
  auditLog('BLOBOSPHERE_UPDATE'), // Log toutes les modifications
  updatePost
);
```

#### 4. Upload de fichiers sécurisé

```typescript
// Validation stricte des uploads
import multer from 'multer';
import sharp from 'sharp';
import { nanoid } from 'nanoid';

const upload = multer({
  limits: {
    fileSize: 10 * 1024 * 1024, // Max 10 MB
    files: 5, // Max 5 fichiers simultanés
  },
  fileFilter: (req, file, cb) => {
    // WHITELIST de types MIME autorisés
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];

    if (!allowedMimes.includes(file.mimetype)) {
      return cb(new Error('Type de fichier non autorisé'));
    }

    // Vérifier l'extension aussi (double check)
    const allowedExts = ['.jpg', '.jpeg', '.png', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();

    if (!allowedExts.includes(ext)) {
      return cb(new Error('Extension de fichier non autorisée'));
    }

    cb(null, true);
  },
});

// Process et sanitize les images
router.post('/admin/media', upload.single('file'), async (req, res) => {
  const file = req.file;

  // Générer un nom aléatoire (sécurité)
  const filename = `${nanoid()}.webp`;

  // Traiter l'image avec Sharp (strip metadata EXIF pour privacy)
  await sharp(file.buffer)
    .resize(1920, 1080, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 85 })
    .withMetadata(false) // ⚠️ IMPORTANT : Supprimer les métadonnées EXIF (GPS, etc.)
    .toFile(`/uploads/blobosphere/${filename}`);

  res.json({ url: `/uploads/blobosphere/${filename}` });
});
```

#### 5. Headers de sécurité

```typescript
// helmet.config.ts
import helmet from 'helmet';

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.blobinfini.com'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'https://images.blobinfini.com', 'data:'],
      connectSrc: ["'self'", 'https://api.blobinfini.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000, // 1 an
    includeSubDomains: true,
    preload: true,
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  xssFilter: true,
  noSniff: true,
  ieNoOpen: true,
}));
```

### 📋 Checklist Sécurité/RGPD avant publication

Avant chaque déploiement de fonctionnalité Blobosphère :

- [ ] ✅ **Consentement** : Formulaire de consentement pour interviews/photos
- [ ] ✅ **Anonymisation** : Aucune donnée personnelle dans les contenus publics
- [ ] ✅ **Cookies** : Banner CNIL conforme + opt-in analytics
- [ ] ✅ **Mentions légales** : Pages /mentions-legales, /politique-confidentialite à jour
- [ ] ✅ **Droit à l'oubli** : Endpoint de suppression fonctionnel
- [ ] ✅ **Durées conservation** : CRON jobs de purge configurés
- [ ] ✅ **Validation entrées** : Zod + DOMPurify sur tous les inputs
- [ ] ✅ **Rate limiting** : Configuré sur toutes les routes
- [ ] ✅ **Auth/Authz** : Routes admin protégées par JWT + rôles
- [ ] ✅ **Upload sécurisé** : Whitelist MIME + strip EXIF metadata
- [ ] ✅ **Headers sécurité** : Helmet configuré (CSP, HSTS, etc.)
- [ ] ✅ **HTTPS** : SSL/TLS actif (obligatoire RGPD)
- [ ] ✅ **Audit logs** : Toutes actions admin loggées
- [ ] ✅ **Modération** : Système de signalement fonctionnel
- [ ] ✅ **Tests sécu** : Tests XSS, injection SQL, CSRF passés

## Architecture Technique

### Stack

```
Frontend:  Next.js 14 (App Router) • ISR/SSG • Tailwind CSS
Backend:   Express API • Prisma ORM • PostgreSQL
Médias:    S3/MinIO • Sharp (optimisation + EXIF strip)
SEO:       next-sitemap • Open Graph • Twitter Cards
Sécurité:  Helmet • Rate-limit • Zod • DOMPurify • JWT
```

### Structure fichiers

```
apps/web/app/blobosphere/
├── page.tsx                    # Liste articles
├── [slug]/
│   └── page.tsx               # Page article (SSG)
└── components/
    ├── ArticleCard.tsx
    ├── ShareButtons.tsx
    ├── ContentRenderer.tsx
    └── CookieBanner.tsx       # ⚠️ RGPD obligatoire

apps/api/src/modules/blobosphere/
├── blobosphere.controller.ts   # Routes API
├── blobosphere.service.ts      # Logique métier
├── blobosphere.repository.ts   # Accès données
├── security/
│   ├── rate-limit.config.ts   # ⚠️ Protection DDoS
│   ├── upload.config.ts       # ⚠️ Validation uploads
│   └── sanitize.helper.ts     # ⚠️ XSS protection
├── dto/
│   ├── create-post.dto.ts
│   └── update-post.dto.ts
└── tests/
    ├── blobosphere.service.test.ts
    ├── blobosphere.controller.test.ts
    └── security.test.ts       # ⚠️ Tests sécu obligatoires
```

## Modèles de données

### BlobospherePost

```prisma
model BlobospherePost {
  id            String              @id @default(cuid())
  slug          String              @unique
  title         String
  excerpt       String              @db.Text
  content       Json                // Rich text sanitizé
  coverImage    String?
  status        PostStatus          @default(DRAFT)
  publishedAt   DateTime?

  // Relations
  authorId      String
  author        User                @relation(fields: [authorId], references: [id])
  topicId       String
  topic         BlobosphereTopic    @relation(fields: [topicId], references: [id])

  // SEO
  metaTitle     String?
  metaDesc      String?
  keywords      String[]

  // Analytics
  viewCount     Int                 @default(0)
  shareCount    Int                 @default(0)

  // RGPD & Sécurité ⚠️
  consentValidUntil DateTime?       // Consentement interview expire
  isAnonymized  Boolean             @default(false)

  // Timestamps
  createdAt     DateTime            @default(now())
  updatedAt     DateTime            @updatedAt
  deletedAt     DateTime?           // Soft delete RGPD

  @@index([status, publishedAt])
  @@index([topicId])
  @@index([slug])
}
```

## Ressources RGPD & Sécurité

### Documentation officielle

- [CNIL - Guide RGPD du développeur](https://www.cnil.fr/fr/guide-rgpd-du-developpeur)
- [CNIL - Cookies et traceurs](https://www.cnil.fr/fr/cookies-et-autres-traceurs)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [ANSSI - Bonnes pratiques](https://www.ssi.gouv.fr/guide/recommandations-de-securite-relatives-a-un-systeme-gnulinux/)

### Contact juridique

- **DPO Blobinfini** : dpo@blobinfini.com
- **CNIL** : https://www.cnil.fr/fr/plaintes
- **Délai réponse RGPD** : 30 jours maximum
