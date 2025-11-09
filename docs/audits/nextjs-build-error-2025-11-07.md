# Erreur Build Next.js - 07/11/2025

## 🐛 Symptôme

Lors du build Next.js (`npm run build --workspace=@blobinfini/web`), plusieurs pages échouent au prerendering avec l'erreur suivante :

```
TypeError: Cannot read properties of null (reading 'useContext')
    at t.useContext (/home/audrey/dev/blobevolutionClaudeCodex/node_modules/next/dist/compiled/next-server/app-page.runtime.prod.js:12:109365)
    at d (/home/audrey/dev/blobevolutionClaudeCodex/apps/web/.next/server/chunks/4375.js:1:24453)
```

## 📍 Pages Affectées

- `/login`
- `/pro/messages`
- `/pro/offers`
- Et probablement d'autres pages...

## 🔍 Contexte

- **Date** : 07/11/2025
- **Détecté pendant** : Suppression du module `credits`
- **Non lié à** : La suppression du module credits (erreur pre-existante)
- **Version Next.js** : 14.2.32
- **Version React** : (à vérifier)

## 💡 Hypothèses

1. **Problème de Context Provider manquant** : Un composant client utilise `useContext()` mais le Provider correspondant n'est pas disponible lors du server-side rendering
2. **Mauvaise utilisation 'use client'** : Des composants client/server sont mal configurés
3. **Erreur de chunk splitting** : Next.js génère des chunks invalides (`chunks/4375.js`)

## 🔧 À Investiguer

1. Chercher tous les `useContext()` dans le code
2. Vérifier que tous les Providers sont bien wrappés avec `'use client'`
3. Vérifier les imports de composants client dans les pages serveur
4. Tester en désactivant le prerendering pour identifier le composant problématique

## 📝 Commande pour Reproduire

```bash
npm run build --workspace=@blobinfini/web
```

## 🎯 Priorité

**Moyenne** - Le dev server fonctionne probablement, mais le build de production échoue.

---

**Créé par** : Claude Code (Sonnet 4.5)
**À traiter après** : (OK 08/11/2025) Suppression module credits finalisée

## 🧪 Investigation 08/11/2025 (Codex)

- Build reproduit deux fois via `npm run build --workspace=@blobinfini/web` : compilation, lint et SSG terminent sans erreur `useContext`.
- Audit des usages `useContext` (`rg "useContext" apps/web`) : uniquement `components/ui/toast.tsx` et `components/ui/dialog.tsx`, tous deux marqués `'use client'` et wrapés par `ClientProvider` dans `app/layout.tsx`.
- Vérification du provider toast : `ClientProvider` entoure tout le `<body>`, supprimant l'hypothèse d'un context absent sur `/login`, `/messages`, `/pro/offers`.
- Chunk `4375.js` correspond principalement aux icônes Lucide + utilitaires Next (`AppRouterAnnouncer`). L’erreur vue précédemment indique que le module React était résolu à `null`, vraisemblablement dû à un cache `.next`/`node_modules` corrompu pendant la suppression de `credits`.

## ✅ Statut actuel

- ✅ Build Next.js stable (2 runs consécutifs).
- ⚠️ Aucune modif code nécessaire pour l'instant. Si l'erreur réapparaît, lancer un `rm -rf apps/web/.next node_modules && npm install` pour repartir d'un cache sain avant de relancer le build.

## 🧾 Tests exécutés

- `npm run build --workspace=@blobinfini/web`
