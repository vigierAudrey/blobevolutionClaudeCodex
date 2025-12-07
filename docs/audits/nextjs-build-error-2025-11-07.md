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
