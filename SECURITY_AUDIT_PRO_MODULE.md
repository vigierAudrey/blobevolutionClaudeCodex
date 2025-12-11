# Audit de Sécurité - Module Pro

**Date**: 2025-12-08
**Auditeur**: Claude Code
**Portée**: Module professionnel (API Backend)

## Résumé Exécutif

Cet audit a identifié **4 failles de sécurité critiques** dans le module professionnel permettant à des utilisateurs RIDER d'accéder à des fonctionnalités réservées aux PRO.

## Failles Identifiées

### 🔴 CRITIQUE - Faille #1: GET /pro/me accessible aux RIDER

**Route**: `GET /pro/me`
**Fichier**: `apps/api/src/modules/pro/pro.controller.ts:86`
**Middleware actuel**: `requireAuth` uniquement
**Middleware requis**: `requireAuth` + `requireProRole`

**Impact**:
- Un utilisateur RIDER peut créer un profil professionnel
- Permet l'élévation de privilèges
- Un RIDER peut se faire passer pour un PRO

**Preuve**:
```typescript
proRouter.get('/me', requireAuth, async (req, res) => {
  // ❌ PAS de vérification du rôle PRO
  let pp = await prisma.proProfile.findUnique({ where: { userId } });
  if (!pp) pp = await prisma.proProfile.create({ data: { userId } });
  return res.json(pp);
});
```

### 🔴 CRITIQUE - Faille #2: PUT /pro/me accessible aux RIDER

**Route**: `PUT /pro/me`
**Fichier**: `apps/api/src/modules/pro/pro.controller.ts:125`
**Middleware actuel**: `requireAuth` uniquement
**Middleware requis**: `requireAuth` + `requireProRole`

**Impact**:
- Un RIDER peut créer/modifier un profil professionnel
- Permet l'usurpation d'identité professionnelle
- Peut créer des offres frauduleuses

### 🔴 CRITIQUE - Faille #3: PATCH /pro/me accessible aux RIDER

**Route**: `PATCH /pro/me`
**Fichier**: `apps/api/src/modules/pro/pro.controller.ts:138`
**Middleware actuel**: `requireAuth` uniquement
**Middleware requis**: `requireAuth` + `requireProRole`

### 🔴 CRITIQUE - Faille #4: POST /pro/photo/upload-url accessible aux RIDER

**Route**: `POST /pro/photo/upload-url`
**Fichier**: `apps/api/src/modules/pro/pro.controller.ts:152`
**Middleware actuel**: `requireAuth` uniquement
**Middleware requis**: `requireAuth` + `requireProRole`

**Impact**:
- Un RIDER peut uploader des photos dans le bucket S3 des professionnels
- Risque de pollution du stockage
- Coût potentiel de stockage non autorisé

## Correctifs Appliqués

### Ajout de requireProRole aux routes vulnérables

```diff
- proRouter.get('/me', requireAuth, async (req, res) => {
+ proRouter.get('/me', requireAuth, requireProRole, async (req, res) => {

- proRouter.put('/me', requireAuth, async (req, res) => {
+ proRouter.put('/me', requireAuth, requireProRole, async (req, res) => {

- proRouter.patch('/me', requireAuth, async (req, res) => {
+ proRouter.patch('/me', requireAuth, requireProRole, async (req, res) => {

- proRouter.post('/photo/upload-url', requireAuth, async (req, res) => {
+ proRouter.post('/photo/upload-url', requireAuth, requireProRole, async (req, res) => {
```

## Audit Module Rider

### À vérifier
- Les PROs ne doivent pas pouvoir modifier les profils RIDER
- Les PROs ne doivent pas pouvoir accéder aux routes réservées aux RIDER
