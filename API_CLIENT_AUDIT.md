# Audit apiClient - Cohérence des appels API

## État actuel

### ✅ Fonctionnel
- L'API backend fonctionne correctement
- Tous les appels API passent (que ce soit via `fetch()` ou `apiClient`)
- Le build Vercel réussit

### ⚠️ Incohérence détectée

**Fichiers concernés :**
1. `apps/web/app/(auth)/forgot-password/page.tsx` (ligne 5)
2. `apps/web/app/(auth)/verify/page.tsx` (ligne 6)

**Problème :**
- Ces fichiers importent `apiClient` mais ne l'utilisent jamais
- Ils utilisent `fetch()` directement à la place
- Cela génère des warnings ESLint (non bloquants)

### Comparaison

**Style actuel dans forgot-password.tsx (inconsistant) :**
```typescript
import { apiClient } from '@/lib/apiClient'; // ❌ Importé mais non utilisé

await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/forgot-password`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email }),
});
```

**Style utilisé partout ailleurs (cohérent) :**
```typescript
import { apiClient } from '@/lib/apiClient'; // ✅ Importé ET utilisé

await apiClient.login({ email, password });
await apiClient.me();
await apiClient.getProfile();
// etc.
```

## Pourquoi c'est important

### 1. Maintenabilité
- **Actuellement :** Si l'URL de l'API change, il faut modifier 2 fichiers + la config
- **Avec apiClient :** Un seul endroit à modifier (`lib/apiClient.ts`)

### 2. Cohérence
- **32 fichiers** utilisent `apiClient` correctement
- **2 fichiers** utilisent `fetch()` directement
- Incohérence dans la base de code

### 3. Gestion des erreurs
- `apiClient` a une gestion d'erreurs centralisée
- `fetch()` direct duplique cette logique

### 4. Authentification
- `apiClient` gère automatiquement les tokens JWT via `withAuth`
- `fetch()` direct nécessite d'ajouter manuellement les headers

## Endpoints manquants dans apiClient

En analysant le code, j'ai constaté que **ces endpoints ne sont pas disponibles dans `apiClient`** :

```typescript
// ❌ Non disponibles dans apiClient
POST /auth/forgot-password
POST /auth/verify-email
POST /auth/reset-password (probablement)
```

**C'est pourquoi** les développeurs ont utilisé `fetch()` direct !

## Recommandations

### Option 1 : Ajouter les endpoints manquants à apiClient ✅ (Recommandé)

**Avantages :**
- Cohérence totale dans la base de code
- Suppression des warnings ESLint
- Meilleure maintenabilité

**Modification suggérée dans `lib/apiClient.ts` :**

```typescript
export const apiClient = {
  // ... endpoints existants ...

  // TODO: Ajouter les endpoints d'authentification manquants
  forgotPassword: (email: string) =>
    request('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email })
    }),

  verifyEmail: (token: string) =>
    request('/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token })
    }),

  resetPassword: (token: string, newPassword: string) =>
    request('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword })
    }),
};
```

**Puis dans les pages :**

```typescript
// forgot-password/page.tsx
await apiClient.forgotPassword(email);

// verify/page.tsx
await apiClient.verifyEmail(token);
```

### Option 2 : Retirer l'import inutilisé ⚠️ (Temporaire)

Si on ne veut pas toucher à la logique réseau maintenant, on peut simplement :

```typescript
// forgot-password/page.tsx
- import { apiClient } from '@/lib/apiClient'; // Retirer cet import
```

**Avantages :**
- Supprime le warning ESLint immédiatement
- Aucun risque de régression

**Inconvénients :**
- Ne résout pas le problème de cohérence
- Laisse la dette technique

### Option 3 : Laisser tel quel 🤷 (Status quo)

**Avantages :**
- Aucun changement, aucun risque
- Le code fonctionne

**Inconvénients :**
- Warnings ESLint persistent
- Incohérence dans la base de code
- Maintenabilité réduite

## Impact sur Vercel

### ✅ Pas d'impact sur le déploiement
- Les warnings ESLint **ne bloquent pas** le build Vercel
- L'application fonctionne normalement en production
- C'est uniquement un problème de **qualité de code**

### 📊 Build actuel
```
 ✓ Compiled successfully
 ⚠ 5:10  Warning: 'apiClient' is defined but never used.
```

Le build **réussit** malgré les warnings.

## Plan d'action suggéré

### Immédiat (pour Vercel) ✅
- **Rien à faire** - Le build passe déjà
- Les corrections de build Vercel sont terminées

### Court terme (amélioration de code)
1. Ajouter les 3 endpoints manquants à `apiClient` (15 min)
2. Refactoriser les 2-3 pages d'auth pour utiliser `apiClient` (20 min)
3. Supprimer les warnings ESLint (bonus)

### Moyen terme (refactoring complet)
- Auditer tous les appels `fetch()` dans le projet
- Standardiser 100% des appels via `apiClient`
- Ajouter des tests unitaires pour `apiClient`

## Conclusion

**Pour le déploiement Vercel :** ✅ Tout est prêt, aucune action requise

**Pour la qualité du code :** Je recommande l'Option 1 (ajouter les endpoints à `apiClient`) lors d'une prochaine session de refactoring, sans urgence.

---

## 🔍 Phase 1 - Observation détaillée (Documentation)

### Analyse complète des endpoints backend

J'ai analysé le fichier `apps/api/src/modules/auth/auth.controller.ts` pour identifier précisément les endpoints manquants.

#### Tableau des endpoints d'authentification

| Endpoint | Méthode | Auth Required | Dans apiClient | Utilisé dans frontend | Ligne backend | Schema validation |
|----------|---------|---------------|----------------|----------------------|---------------|-------------------|
| `/auth/register` | POST | ❌ | ✅ | ✅ | 63 | `registerSchema` |
| `/auth/login` | POST | ❌ | ✅ | ✅ | 83 | `loginSchema` |
| `/auth/refresh` | POST | ❌ | ❌ | ❌ | 107 | `refreshSchema` |
| `/auth/logout` | POST | ✅ `requireAuth` | ✅ | ✅ | 123 | `logoutSchema` |
| `/auth/verify-email` | POST | ❌ | ❌ | ✅ `verify/page.tsx:33` | 143 | `verifyEmailSchema` |
| `/auth/resend-verification` | POST | ❌ | ✅ | ✅ | 160 | `resendVerifySchema` |
| `/auth/me` | GET | ✅ `requireAuth` | ✅ | ✅ | 173 | - |
| `/auth/forgot-password` | POST | ❌ | ❌ | ✅ `forgot-password/page.tsx:22` | 199 | `forgotSchema` |
| `/auth/reset-password` | POST | ❌ | ❌ | ✅ `reset-password/page.tsx:30` | 212 | `resetSchema` |
| `/auth/2fa/send` | POST | ❌ | ✅ | ✅ | 229 | `send2FASchema` |
| `/auth/2fa/verify` | POST | ❌ | ✅ | ✅ | 262 | `verify2FASchema` |

### 🎯 Endpoints manquants dans apiClient (3 identifiés)

| Endpoint | Méthode | Auth | Statut | Commentaire | Frontend concerné |
|----------|---------|------|--------|-------------|-------------------|
| `/auth/forgot-password` | POST | ❌ | **Manquant** | Accessible sans token, validation email | `apps/web/app/(auth)/forgot-password/page.tsx:22` |
| `/auth/verify-email` | POST | ❌ | **Manquant** | Validation email via token reçu par mail | `apps/web/app/(auth)/verify/page.tsx:33` |
| `/auth/reset-password` | POST | ❌ | **Manquant** | Réinitialisation mot de passe, token + nouveau password | `apps/web/app/(auth)/reset-password/page.tsx:30` |

### 📋 Spécifications techniques des endpoints manquants

#### 1. `/auth/forgot-password`

**Backend (auth.controller.ts:199-210)**
```typescript
authRouter.post('/forgot-password', async (req, res) => {
  const { email } = forgotSchema.parse(req.body);
  // Schema: z.object({ email: z.string().email() })
  const result = await service.forgotPassword(email);
  res.json(result);
});
```

**Frontend actuel (forgot-password/page.tsx:22)**
```typescript
await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/forgot-password`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email }),
});
```

**Proposition pour apiClient.ts** (⚠️ NE PAS IMPLÉMENTER MAINTENANT)
```typescript
forgotPassword: (email: string) =>
  request('/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email })
  }),
  // withAuth = false (3ème paramètre omis ou false)
```

**Validation backend :**
- Input: `{ email: string }` (valide email)
- Output: `{ success: boolean, message: string }`
- Auth: ❌ Non requis (endpoint public)
- Erreurs: 400 (validation), 500 (erreur serveur)

---

#### 2. `/auth/verify-email`

**Backend (auth.controller.ts:143-157)**
```typescript
authRouter.post('/verify-email', async (req, res) => {
  const { token } = verifyEmailSchema.parse(req.body);
  // Schema: z.object({ token: z.string().min(10) })
  const result = await service.verifyEmail(token);
  res.json(result);
});
```

**Frontend actuel (verify/page.tsx:33)**
```typescript
await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/verify-email`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: t }),
});
```

**Proposition pour apiClient.ts** (⚠️ NE PAS IMPLÉMENTER MAINTENANT)
```typescript
verifyEmail: (token: string) =>
  request('/auth/verify-email', {
    method: 'POST',
    body: JSON.stringify({ token })
  }),
  // withAuth = false
```

**Validation backend :**
- Input: `{ token: string }` (min 10 caractères)
- Output: `{ success: boolean, message: string }`
- Auth: ❌ Non requis (endpoint public)
- Erreurs: 400 (validation), 401 (token invalide/expiré), 500 (erreur serveur)

---

#### 3. `/auth/reset-password`

**Backend (auth.controller.ts:212-226)**
```typescript
authRouter.post('/reset-password', async (req, res) => {
  const { token, password } = resetSchema.parse(req.body);
  // Schema: z.object({
  //   token: z.string().min(10),
  //   password: z.string().min(8)
  // })
  const result = await service.resetPassword(token, password);
  res.json(result);
});
```

**Frontend actuel (reset-password/page.tsx:30)**
```typescript
await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/reset-password`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token, password }),
});
```

**Proposition pour apiClient.ts** (⚠️ NE PAS IMPLÉMENTER MAINTENANT)
```typescript
resetPassword: (token: string, password: string) =>
  request('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, password })
  }),
  // withAuth = false
```

**Validation backend :**
- Input: `{ token: string, password: string }` (token min 10, password min 8)
- Output: `{ success: boolean, message: string }`
- Auth: ❌ Non requis (endpoint public)
- Erreurs: 400 (validation), 401 (token invalide/expiré), 500 (erreur serveur)

---

### 🔧 Endpoint bonus : `/auth/refresh` (non utilisé actuellement)

**Backend (auth.controller.ts:107-121)**
```typescript
authRouter.post('/refresh', validate(refreshSchema), async (req, res) => {
  const { refreshToken } = req.body;
  const result = await service.refresh(refreshToken);
  res.json(result);
});
```

**Statut :** Non implémenté dans `apiClient.ts`, mais **non utilisé** dans le frontend actuel.

**Note :** Le refresh token est géré manuellement dans le frontend via `localStorage`. Si besoin d'implémenter un refresh automatique, cet endpoint sera nécessaire.

---

## 📊 Récapitulatif des fichiers concernés

### Frontend à migrer (3 fichiers)

| Fichier | Ligne | Endpoint utilisé | Import apiClient | Utilise apiClient |
|---------|-------|------------------|------------------|-------------------|
| `apps/web/app/(auth)/forgot-password/page.tsx` | 22 | `/auth/forgot-password` | ✅ Ligne 5 | ❌ Utilise fetch() |
| `apps/web/app/(auth)/verify/page.tsx` | 33 | `/auth/verify-email` | ✅ Ligne 6 | ❌ Utilise fetch() |
| `apps/web/app/(auth)/reset-password/page.tsx` | 30 | `/auth/reset-password` | ❌ Aucun import | ❌ Utilise fetch() |

### Backend (référence)

| Fichier | Description |
|---------|-------------|
| `apps/api/src/modules/auth/auth.controller.ts` | Définition de tous les endpoints d'auth (lignes 199, 143, 212) |
| `apps/api/src/modules/auth/auth.service.ts` | Logique métier (non audité, pas nécessaire pour le refactor frontend) |

---

## 🚦 Plan de migration (Phase 2 - À valider avant exécution)

### Étape 1 : Ajout des endpoints dans apiClient.ts

**Fichier :** `apps/web/lib/apiClient.ts`

**Position suggérée :** Après la ligne 420 (après `verify2FA`), avant `getProfile`

**Code à ajouter** (⚠️ **NE PAS COPIER MAINTENANT**) :

```typescript
// Password recovery endpoints
forgotPassword: (email: string) =>
  request('/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email })
  }),

verifyEmail: (token: string) =>
  request('/auth/verify-email', {
    method: 'POST',
    body: JSON.stringify({ token })
  }),

resetPassword: (token: string, password: string) =>
  request('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, password })
  }),
```

**Validation :**
- ✅ Aucun paramètre `withAuth` (par défaut `false`)
- ✅ Même signature que les autres endpoints non-auth
- ✅ Types de retour : `Promise<any>` (peut être typé plus finement si besoin)

---

### Étape 2 : Migration de forgot-password/page.tsx

**Fichier :** `apps/web/app/(auth)/forgot-password/page.tsx`

**Changements** (⚠️ **NE PAS APPLIQUER MAINTENANT**) :

```diff
  "use client";

  export const dynamic = 'force-dynamic';
  import { useState } from 'react';
+ import { apiClient } from '@/lib/apiClient';
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
  // ... autres imports ...

  export default function ForgotPasswordPage() {
    // ... états ...

    const onSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      setStatus('loading');
      setMessage('');
      try {
-       await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/auth/forgot-password`, {
-         method: 'POST',
-         headers: { 'Content-Type': 'application/json' },
-         body: JSON.stringify({ email }),
-       });
+       await apiClient.forgotPassword(email);
        setStatus('done');
        setMessage('Si le compte existe, un email de réinitialisation a été envoyé.');
-     } catch (e: any) {
+     } catch (e: unknown) {
        setStatus('error');
-       setMessage(e?.message || 'Erreur lors de la demande');
+       setMessage(e instanceof Error ? e.message : 'Erreur lors de la demande');
      }
    };
```

**Impact :**
- ✅ Supprime le warning ESLint
- ✅ Code plus concis (1 ligne vs 5 lignes)
- ✅ Gestion d'erreur centralisée
- ✅ Meilleur typage TypeScript

---

### Étape 3 : Migration de verify/page.tsx

**Fichier :** `apps/web/app/(auth)/verify/page.tsx`

**Changements** (⚠️ **NE PAS APPLIQUER MAINTENANT**) :

```diff
  const verify = async (t: string) => {
    setStatus('loading');
    setMessage('');
    try {
-     await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/auth/verify-email`, {
-       method: 'POST',
-       headers: { 'Content-Type': 'application/json' },
-       body: JSON.stringify({ token: t }),
-     });
+     await apiClient.verifyEmail(t);
      setStatus('success');
      setMessage('Email vérifié avec succès. Redirection…');
-   } catch (e: any) {
+   } catch (e: unknown) {
      setStatus('error');
-     setMessage(e?.message || 'Impossible de vérifier le token');
+     setMessage(e instanceof Error ? e.message : 'Impossible de vérifier le token');
    }
  };
```

---

### Étape 4 : Migration de reset-password/page.tsx

**Fichier :** `apps/web/app/(auth)/reset-password/page.tsx`

**Changements** (⚠️ **NE PAS APPLIQUER MAINTENANT**) :

```diff
  "use client";

  export const dynamic = 'force-dynamic';
  import { Suspense, useEffect, useState } from 'react';
  import { useSearchParams, useRouter } from 'next/navigation';
+ import { apiClient } from '@/lib/apiClient';
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
  // ... autres imports ...

  function ResetPasswordInner() {
    // ... états ...

    const onSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      setStatus('loading');
      setMessage('');
      try {
-       await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/auth/reset-password`, {
-         method: 'POST',
-         headers: { 'Content-Type': 'application/json' },
-         body: JSON.stringify({ token, password }),
-       });
+       await apiClient.resetPassword(token, password);
        setStatus('done');
        setMessage('Mot de passe mis à jour. Tu peux te connecter.');
-     } catch (e: any) {
+     } catch (e: unknown) {
        setStatus('error');
-       setMessage(e?.message || 'Impossible de réinitialiser');
+       setMessage(e instanceof Error ? e.message : 'Impossible de réinitialiser');
      }
    };
```

---

## ✅ Checklist de validation avant migration (Phase 2)

### Pré-requis techniques

- [ ] Backup de la branche actuelle
- [ ] Tests locaux de l'API backend fonctionnels
- [ ] Variables d'environnement `NEXT_PUBLIC_API_URL` configurées
- [ ] Base de données de test disponible

### Ajout des endpoints (apiClient.ts)

- [ ] Code ajouté dans `lib/apiClient.ts` (après ligne 420)
- [ ] Pas de paramètre `withAuth` (endpoints publics)
- [ ] Signatures correctes : `forgotPassword(email)`, `verifyEmail(token)`, `resetPassword(token, password)`
- [ ] Types de retour : `Promise<any>` ou mieux `Promise<{ success: boolean; message: string }>`
- [ ] Build Next.js réussit (`npm run build:web`)
- [ ] Aucune erreur TypeScript (`npm run type-check -w @blobinfini/web`)

### Migration de forgot-password/page.tsx

- [ ] Import `apiClient` ajouté
- [ ] Appel `fetch()` remplacé par `apiClient.forgotPassword(email)`
- [ ] Gestion d'erreur améliorée (`e: unknown`, `e instanceof Error`)
- [ ] Build réussit, warning ESLint disparu
- [ ] Test manuel : formulaire envoie bien l'email
- [ ] Test manuel : réception de l'email de réinitialisation

### Migration de verify/page.tsx

- [ ] Import `apiClient` déjà présent (ligne 6)
- [ ] Appel `fetch()` remplacé par `apiClient.verifyEmail(token)`
- [ ] Gestion d'erreur améliorée
- [ ] Warning ESLint disparu
- [ ] Test manuel : lien de vérification email fonctionne
- [ ] Test manuel : redirection vers `/login` après succès

### Migration de reset-password/page.tsx

- [ ] Import `apiClient` ajouté
- [ ] Appel `fetch()` remplacé par `apiClient.resetPassword(token, password)`
- [ ] Gestion d'erreur améliorée
- [ ] Build réussit
- [ ] Test manuel : réinitialisation du mot de passe fonctionne
- [ ] Test manuel : connexion avec nouveau mot de passe réussit

### Tests de régression

- [ ] Login/Logout fonctionnent toujours
- [ ] Inscription fonctionne toujours
- [ ] Dashboard accessible après login
- [ ] Aucune régression sur les autres pages d'auth

### Déploiement Vercel

- [ ] Build Vercel réussit
- [ ] Variables d'environnement configurées en production
- [ ] Tests manuels en production
- [ ] Monitoring des erreurs (Sentry ou logs Vercel)

---

## 🔐 Sécurité - Points de vigilance

### Pas de régression sur les tokens JWT

- ✅ Les endpoints migrés (`forgot-password`, `verify-email`, `reset-password`) **ne nécessitent PAS de token JWT**
- ✅ Aucun risque de perte de session utilisateur
- ✅ Pas d'impact sur `localStorage` (accessToken/refreshToken)

### Gestion des erreurs

**Actuel (fetch direct) :**
```typescript
catch (e: any) {
  setMessage(e?.message || 'Erreur');
}
```

**Proposé (apiClient) :**
```typescript
catch (e: unknown) {
  setMessage(e instanceof Error ? e.message : 'Erreur');
}
```

**Amélioration :**
- ✅ TypeScript plus strict (`unknown` au lieu de `any`)
- ✅ Validation du type d'erreur avant accès à `.message`
- ✅ Pas de changement fonctionnel, seulement amélioration du typage

### Validation backend reste inchangée

- ✅ Le backend utilise `zod` pour valider les inputs (pas d'impact)
- ✅ Les codes d'erreur HTTP restent identiques (400, 401, 500)
- ✅ Les messages d'erreur backend sont préservés

---

## 📝 Logs de test recommandés (Phase 3)

### Test 1 : Forgot password

```bash
# Console navigateur
console.log('Sending forgot password request:', { email });
# Après appel apiClient
console.log('Forgot password response:', response);
```

**Résultat attendu :**
```json
{ "success": true, "message": "Si le compte existe, un email a été envoyé" }
```

### Test 2 : Verify email

```bash
console.log('Verifying email with token:', token);
console.log('Verify email response:', response);
```

**Résultat attendu :**
```json
{ "success": true, "message": "Email verified successfully" }
```

### Test 3 : Reset password

```bash
console.log('Resetting password:', { token, passwordLength: password.length });
console.log('Reset password response:', response);
```

**Résultat attendu :**
```json
{ "success": true, "message": "Password updated successfully" }
```

---

## 📈 Métriques de succès

### Qualité de code

- **Avant :** 2 warnings ESLint (`apiClient` non utilisé)
- **Après :** 0 warnings ESLint
- **Avant :** 3 fichiers avec `fetch()` direct
- **Après :** 0 fichiers avec `fetch()` direct (100% apiClient)

### Maintenabilité

- **Avant :** URL de l'API dupliquée dans 3 fichiers + apiClient.ts = 4 endroits
- **Après :** URL de l'API centralisée dans apiClient.ts = 1 seul endroit

### Cohérence

- **Avant :** 32 fichiers utilisent apiClient, 3 fichiers utilisent fetch()
- **Après :** 35 fichiers utilisent apiClient, 0 fichiers utilisent fetch() (100% cohérent)

---

**Créé le :** 2025-10-14
**Mis à jour le :** 2025-10-14 (Phase 1 - Observation complétée)
**Impact build :** Aucun (warnings seulement)
**Priorité :** Basse (amélioration qualité)
**Effort estimé :** 30-45 minutes (Phase 2 + 3)
**Statut :** ⏸️ En attente de validation pour Phase 2
