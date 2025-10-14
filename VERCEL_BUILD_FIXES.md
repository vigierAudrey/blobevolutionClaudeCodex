# Corrections des problèmes de build Vercel

## Problèmes identifiés

1. **Configuration monorepo inadaptée** : Vercel ne gérait pas correctement l'installation et le build dans une structure monorepo
2. **Script postinstall problématique** : L'exécution de Prisma generate dans le postinstall causait des erreurs durant le déploiement
3. **Commandes de build non optimisées** : Les commandes dans vercel.json n'étaient pas adaptées à la structure du projet

## Corrections appliquées

### 1. Mise à jour de `vercel.json` (déplacé dans `apps/web/`)

**⚠️ Changement important (2024+) :** `rootDirectory` n'est plus supporté dans `vercel.json`

**Avant (racine du projet) :**
```json
{
  "buildCommand": "npm run build",
  "installCommand": "npm install",
  "rootDirectory": "apps/web"  // ❌ Non supporté depuis 2024
}
```

**Après (`apps/web/vercel.json`) :**
```json
{
  "buildCommand": "cd ../.. && npm run build:web",
  "installCommand": "cd ../.. && npm install",
  "framework": "nextjs"
}
```

**Explications :**
- **Emplacement :** Fichier déplacé de la racine vers `apps/web/vercel.json`
- **`rootDirectory` supprimé :** Doit être configuré dans le dashboard Vercel (Project Settings → Root Directory → `apps/web`)
- `installCommand` : Navigue vers la racine et installe les dépendances monorepo
- `buildCommand` : Navigue vers la racine et exécute le script `build:web`

### 2. Mise à jour de `package.json` (racine)

**Avant :**
```json
{
  "scripts": {
    "postinstall": "(cd packages/database && npx prisma generate) && (npm run build --workspace @blobinfini/database || true) && patch-package"
  }
}
```

**Après :**
```json
{
  "scripts": {
    "postinstall": "patch-package",
    "prepare": "(cd packages/database && npx prisma generate) && (npm run build --workspace @blobinfini/database || true)",
    "build:web": "npm run db:generate && npm run build --workspace @blobinfini/web"
  }
}
```

**Explications :**
- **`postinstall` simplifié** : Ne contient plus que `patch-package` pour éviter les erreurs Prisma durant le déploiement
- **Nouveau script `prepare`** : Exécute la génération Prisma en développement local
- **Nouveau script `build:web`** : Script dédié pour le build de l'application web qui :
  1. Génère les clients Prisma (`db:generate`)
  2. Build l'application Next.js

### 3. Configuration Vercel Dashboard (Important !)

**⚠️ Action manuelle requise dans le dashboard Vercel :**

1. Allez dans **Project Settings** de votre projet
2. Section **General** → **Root Directory**
3. Définissez : `apps/web`
4. Sauvegardez

Sans cette configuration, Vercel cherchera le projet à la racine et ne trouvera pas `next.config.mjs`.

### 4. Copie du `.vercelignore` vers `apps/web/` pour compatibilité Vercel 2025

**Problème :** Avec `vercel.json` déplacé dans `apps/web/`, le `.vercelignore` à la racine n'est plus pris en compte.

**Solution :** Copie de `.vercelignore` dans `apps/web/.vercelignore` avec ajustement des chemins relatifs.

**Fichier racine (`.vercelignore`) :**
```
apps/api
apps/*/node_modules
```

**Fichier apps/web (`.vercelignore`) :**
```
# Chemins relatifs depuis apps/web/
../api
../*/node_modules
```

**Changements appliqués :**
- ✅ `.vercelignore` copié vers `apps/web/.vercelignore`
- ✅ Chemins ajustés : `apps/api` → `../api` (relatif depuis `apps/web/`)
- ✅ Fichier racine conservé (utile pour le monorepo)

**Avantages :**
- Vercel ignore correctement `apps/api/` lors du déploiement frontend
- Optimisation de la taille du déploiement
- Pas de rupture CI/CD

### 5. Création initiale de `.vercelignore`

Un fichier `.vercelignore` avait été créé pour optimiser le déploiement :

```
# Ignore API et autres apps
apps/api
apps/*/node_modules

# Ignore tests et documentation
*.test.ts
*.test.tsx
__tests__
tests
docs

# Ignore Storybook
.storybook
storybook-static
*.stories.tsx

# Ignore fichiers de développement
.env.local
.env.development
```

**Avantages :**
- Déploiement plus rapide
- Moins de fichiers à analyser
- Évite les conflits avec les dépendances non nécessaires

## Vérification locale

Le build a été testé localement avec succès :

```bash
npm run build:web
```

**Résultat :** ✅ Build réussi avec seulement des warnings ESLint (pas d'erreurs bloquantes)

## Prochaines étapes pour le déploiement Vercel

### 1. Variables d'environnement à configurer dans Vercel

Dans les paramètres de votre projet Vercel, ajoutez les variables suivantes :

**Obligatoires :**
- `NEXT_PUBLIC_API_URL` : URL de votre API backend (ex: https://app-xxxxx.cleverapps.io)
- `NEXT_PUBLIC_SITE_URL` : URL de votre site Vercel (ex: https://blobinfini.vercel.app)
- `DATABASE_URL` : URL de connexion PostgreSQL (pour la génération Prisma)

**Optionnelles (Firebase) :**
- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`

**Configuration :**
- `NEXT_TELEMETRY_DISABLED=1`

### 2. Configuration Vercel via l'interface

1. Connectez votre dépôt GitHub à Vercel
2. Vercel détectera automatiquement `vercel.json`
3. Le `rootDirectory` sera automatiquement configuré sur `apps/web`
4. Les commandes de build et d'installation seront prises depuis `vercel.json`

### 3. Déploiement

**Option A : Automatique**
- Chaque push sur `main` ou `develop` déclenchera un déploiement automatique

**Option B : Manuel**
```bash
npm i -g vercel
vercel login
vercel --prod
```

## Points d'attention

### Prisma
- ✅ La génération du client Prisma est maintenant intégrée dans le script `build:web`
- ✅ Le `postinstall` n'exécute plus Prisma, évitant les erreurs de permissions Vercel
- ⚠️ Assurez-vous que `DATABASE_URL` est définie dans les variables d'environnement Vercel

### Next.js
- ✅ Le build Next.js fonctionne correctement
- ⚠️ Quelques warnings ESLint (non bloquants) :
  - Variables non utilisées
  - Utilisation de `any` dans certains composants
  - Caractères apostrophes non échappés

### Monorepo
- ✅ L'installation se fait depuis la racine, respectant la structure des workspaces
- ✅ Seuls les packages nécessaires sont installés grâce à `.vercelignore`

## Résolution des problèmes précédents

### ❌ Problème 1 : "Cannot find module @prisma/client"
**Cause :** Prisma generate n'était pas exécuté durant le build
**Solution :** Ajout de `npm run db:generate` dans le script `build:web`

### ❌ Problème 2 : Erreurs dans le postinstall
**Cause :** Prisma generate échouait dans postinstall sur Vercel
**Solution :** Déplacement vers le script `prepare` et intégration dans `build:web`

### ❌ Problème 3 : Build échoue avec "command not found"
**Cause :** Commandes de build exécutées dans le mauvais contexte
**Solution :** Utilisation de `cd ../..` pour naviguer vers la racine avant le build

### ❌ Problème 4 : Dépendances manquantes
**Cause :** Installation locale dans `apps/web` au lieu de la racine
**Solution :** `installCommand` avec `--prefix ../..` pour installer depuis la racine

## Logs de build attendus

Lors d'un déploiement Vercel réussi, vous devriez voir :

```
1. Installing dependencies...
   → npm install --prefix ../..
   ✓ Dependencies installed

2. Building application...
   → cd ../.. && npm run build:web
   → npm run db:generate
   ✓ Generated Prisma Client
   → npm run build --workspace @blobinfini/web
   ✓ Compiled successfully
   ✓ Build completed

3. Uploading build artifacts...
   ✓ Build deployed successfully
```

## Support

Si vous rencontrez des problèmes lors du déploiement :

1. Vérifiez que toutes les variables d'environnement sont configurées
2. Consultez les logs de build Vercel pour des erreurs spécifiques
3. Assurez-vous que `DATABASE_URL` est accessible depuis les serveurs Vercel
4. Vérifiez que le fichier `vercel.json` n'a pas été modifié accidentellement

---

**Date de correction :** 2025-10-13
**Testé localement :** ✅ Réussi
**Prêt pour déploiement Vercel :** ✅ Oui
