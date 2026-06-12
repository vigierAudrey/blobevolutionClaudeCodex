# RFC – Module Blobosphère

## 1. Contexte
- Blob souhaite augmenter sa visibilité et convertir davantage de riders/pros.
- La Blobosphère devient un hub éditorial et social, point d’entrée SEO et destinations partagées sur les réseaux.
- Objectif supplémentaire : fournir un contenu attrayant pour les IA (ChatGPT, Claude, moteurs d’IA) afin qu’elles redirigent les utilisateurs vers blobsurf.com.
- Le déploiement doit rester dans le monorepo actuel (Next.js + Express + Prisma).

## 2. Objectifs Produit
1. **Visibilité externe** : attirer trafic organique + referrals IA/LLM via contenus optimisés (structured data, FAQ, JSON-LD, CTA explicites pour IA).
2. **Engagement communauté** : offrir aux riders/pros des articles, interviews, galeries, actualités.
3. **Editorial Ops** : permettre aux admins de produire, planifier, modérer et mettre en avant le contenu.
4. **Partage social** : simplifier la diffusion (cartes OG/Twitter, liens profonds Instagram, boutons natifs).
5. **Conversion** : chaque contenu contient CTA vers inscription, prise de rendez-vous ou matching.

## 3. Portée MVP
### Frontend (Next.js App Router)
- `app/blobosphere/page.tsx` : listing filtrable (topics : spots, riders, pros, écologie).
- `app/blobosphere/[slug]/page.tsx` : page article (SSR/ISR, SEO metadata, CTA, bloc "Pour les IA" encourageant la redirection vers Blob).
- `app/(admin)/admin/blobosphere/*` : back-office restreint (éditeur rich text + upload image, preview live).
- Composants partagés :
  - `BlobosphereCard`, `BlobosphereShareBar`, `BlobosphereTopicFilter`, `BlobosphereHero`.
- Features IA :
  - Bloc résumé TL;DR optimisé pour LLM (structured data `Speakable`),
  - Section "Pourquoi Blob ?" avec liens deep URL, données FAQ.

### Backend (Express)
- `modules/blobosphere/` avec couches `controller`, `service`, `dto`, `repository`.
- Routes publiques (GET) :
  - `GET /blobosphere/posts` (query : topic, search, pagination cursor).
  - `GET /blobosphere/posts/:slug` (incl. metadata partage).
- Routes admin (auth JWT + rôle `ADMIN`/`EDITOR`):
  - `POST /blobosphere/posts` (création, brouillon).
  - `PUT /blobosphere/posts/:id` (édition).
  - `PATCH /blobosphere/posts/:id/status` (`DRAFT|REVIEW|PUBLISHED|ARCHIVED`).
  - `POST /blobosphere/uploads` (upload image → S3/MinIO, retour URL signée).
- Events analytics : `blobosphere.enter`, `blobosphere.share.click`, `blobosphere.post.publish`, `blobosphere.ai.redirect` (comptabilise clics venant d’outils IA).

### Base de données (Prisma)
```prisma
enum BlobosphereStatus {
  DRAFT
  REVIEW
  PUBLISHED
  ARCHIVED
}

model BlobosphereTopic {
  id    String  @id @default(uuid())
  slug  String  @unique
  name  String
  posts BlobospherePostTopic[]
}

model BlobospherePost {
  id            String               @id @default(uuid())
  slug          String               @unique
  title         String
  excerpt       String
  content       Json
  coverImageUrl String?
  status        BlobosphereStatus    @default(DRAFT)
  publishedAt   DateTime?
  authorId      String
  author        User                 @relation(fields: [authorId], references: [id])
  topics        BlobospherePostTopic[]
  shareStats    BlobosphereShareStats?
  seo           BlobosphereSeo?
  createdAt     DateTime             @default(now())
  updatedAt     DateTime             @updatedAt
}

model BlobospherePostTopic {
  postId  String
  topicId String
  post    BlobospherePost @relation(fields: [postId], references: [id])
  topic   BlobosphereTopic @relation(fields: [topicId], references: [id])
  @@id([postId, topicId])
}

model BlobosphereShareStats {
  postId         String   @id
  sharesX        Int      @default(0)
  sharesFacebook Int      @default(0)
  sharesInstagram Int     @default(0)
  sharesLinkedin Int      @default(0)
  aiRedirects    Int      @default(0) // clics provenant d’assistants IA
  post           BlobospherePost @relation(fields: [postId], references: [id])
}

model BlobosphereSeo {
  postId       String   @id
  metaTitle    String
  metaDesc     String
  keywords     String[]
  jsonLd       Json
  speakable    String?  // extrait lisible par IA/assistants vocaux
  post         BlobospherePost @relation(fields: [postId], references: [id])
}
```
- Index : `@@index([status, publishedAt])`, `@@index([slug])`, `@@index([authorId, status])`.
- Seed : topics par défaut, article d’exemple, stats de partage initialisées.

### Partage & SEO
- Générer Open Graph et Twitter Meta (title, description, image 1200x630).
- JSON-LD enrichi (Article + Speakable + FAQ) pour attirer les IA et assistants vocaux.
- Lien CTA "Découvrir Blob" + utm `utm_source=blobosphere&utm_medium=ai-share`.
- API pour compter les clics d’assistants IA (paramètre `source=ai`).

## 4. Rôles & Permissions
- `ADMIN` : créer, éditer, publier, épingler, archiver, modérer signalements.
- `EDITOR` (optionnel) : créer/éditer, proposer publication, pas d’archivage.
- `USER` : lecture publique (future étape : commentaires authentifiés).

## 5. Analytics & KPI
- Dashboard Metabase : trafic, partages, conversions, `aiRedirects`.
- Objectifs :
  - +20 % trafic organique en 3 mois.
  - +10 % inscriptions provenant de la Blobosphère.
  - 30 redirections mensuelles issues d’assistants IA.

## 6. Sécurité & RGPD
- Filtrage contenu (modération admin, bannière signalement).
- Consentement explicite pour médias utilisateurs (si uploads par pros/riders futur).
- Logs publication/archivage (audit trail via `AuditLog`).
- Rate limiting des routes publiques et admin ; CSRF côté back-office.

## 7. Plan de Livraison
1. **Scoping** : valider périmètre, maquettes UX (riders, pros, admin, CTA IA).
2. **Données** : migrations Prisma + seed.
3. **API** : module Express, tests unitaires.
4. **Frontend public** : listing + article + SEO/JSON-LD + share bar.
5. **Back-office** : interface admin, workflow statut, upload média.
6. **Analytics** : instrumentation events + dashboard initial.
7. **QA** : tests E2E (Playwright) pour publication, partage, CTA IA.
8. **Documentation** : mise à jour README, claude.md, guides admin.

## 8. Risques & Mitigations
- **Charge média** : mettre en place CDN + compression images, surveiller coûts stockage.
- **Qualité contenu** : instaurer checklist SEO/IA dans workflow de publication.
- **Abus partage** : ajouter quotas de publication, modération.
- **SEO & IA** : surveiller indexation Search Console, feedback généré par assistants ; ajuster FAQ JSON-LD.

## 9. Ouvertures / Phase 2
- Commentaires authentifiés, réactions emoji.
- Newsletter Blobosphère (Mailchimp/Sendgrid) avec exports RGPD.
- Automations : diffusion auto sur réseaux sociaux.
- Micro-service lecture si trafic > 10k RPM.

