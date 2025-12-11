# Migration Prisma 6

## Synthèse rapide
- **Objectif** : migration de Prisma 5.22.0 vers Prisma 6.19.0 dans le workspace `@blobinfini/database`.
- **Statut** : dépendances mises à jour et Prisma Client régénéré, mais les vérifications échouent (TypeScript `implicit any` et accès base de données absent).
- **Décision requise** : apporter les correctifs TypeScript (ou ajuster la config) et lancer les commandes Prisma en présence d’une base Postgres disponible.

## Compatibilité plateforme
| Outil | Version avant | Version après | Commentaire |
|-------|---------------|---------------|-------------|
| Node  | 22.19.0       | 22.19.0       | Compatible avec Prisma 6. |
| npm   | 10.9.3        | 10.9.3        | RAS. |
| TypeScript (`apps/api`, `apps/web`, `packages/database`) | 5.4.x | 5.6.3 | Montée de version nécessaire pour Prisma 6. |
| `prisma` (`@blobinfini/database`) | 5.22.0 | 6.19.0 | Mise à jour via npm workspace. |
| `@prisma/client` (`@blobinfini/database`) | 5.22.0 | 6.19.0 | Génération client effectuée. |

## Inventaire Prisma
- `packages/database/prisma/schema.prisma`
- Scripts Prisma (workspace `@blobinfini/database`) : `generate`, `migrate`, `db:push`, `studio`, `seed`, `reset`, etc.
- Aucune autre workspace avec Prisma détectée.

## Actions réalisées
1. Création de branche : `git checkout -b chore/prisma6-upgrade`.
2. Mise à jour ciblée :
   - `npm install --workspace @blobinfini/database @prisma/client@latest`
   - `npm install --workspace @blobinfini/database prisma@latest --save-dev`
3. Démarrage Postgres local : `docker compose up -d postgres`.
4. Génération client : `npx prisma generate` (warning : `package.json#prisma` est déprécié → prévoir migration vers `prisma.config.ts` avant Prisma 7).
5. Build workspace DB pour produire les déclarations TypeScript.
6. Mise à jour TypeScript `^5.6.3` dans `apps/api`, `apps/web`, `packages/database`.

## Vérifications et résultats
| Commande | Résultat | Détails |
|----------|----------|---------|
| Commande | Résultat | Détails |
|----------|----------|---------|
| `npx prisma migrate status --schema prisma/schema.prisma` | ✅ | 20 migrations détectées, base alignée. |
| `npx prisma db push --skip-generate --schema prisma/schema.prisma` | ✅ | Aucun diff détecté (base déjà synchronisée). |
| `npx prisma generate` | ✅ | Prisma Client 6.19.0 régénéré (warning dépréciation `package.json#prisma`). |
| `npm run -ws type-check` | ❌ | ~65 erreurs `TS7006` / `TS2339` sur `apps/api` (ex. `admin.controller.ts:50`, `matching.controller.ts:436`). |
| `npm test --workspace @blobinfini/api` | ❌ | Suite Jest bloquée par les mêmes erreurs TypeScript avant exécution des tests. |

### Analyse préliminaire des erreurs TypeScript
- Les erreurs `implicit any` surgissent lors d’itérations (`array.map`, `reduce`, transactions Prisma).
- Hypothèses : les types générés par Prisma 6 ne sont pas correctement résolus (vérifier la génération des `.d.ts` / chemins `@blobinfini/database`) ou les nouvelles signatures requièrent des annotations explicites.
- Pistes : forcer l’émission de déclarations (`packages/database/tsconfig.build.json`) – déjà fait –, vérifier la résolution des types `@blobinfini/database` et, si nécessaire, ajouter des annotations ou adapter la config TypeScript.

## Audit sécurité
- `npm audit --omit=dev` (après migration) : **1 vulnérabilité modérée** (`tar@7.5.1`, course condition). Même alerte signalée pendant `npm install`. Pas de correctif auto appliqué.
- Baseline pré-migration : non capturée in situ (nécessite relance audit sur lockfile d’origine si besoin de comparaison exacte).

## Points d’attention
- **Config Prisma** : le bloc `package.json#prisma` est obsolète → planifier migration vers `prisma.config.ts`.
- **Base de données** : indispensable pour valider `migrate status`, `db push` et tests Jest (`jest.setup.db.ts`).
- **Type-check** : les erreurs doivent être corrigées avant merge (sinon rollback recommandé).

## Rollback express
```bash
git checkout chore/prisma6-upgrade
npm install --workspace @blobinfini/database @prisma/client@5.22.0
npm install --workspace @blobinfini/database prisma@5.22.0 --save-dev
npm install --workspace @blobinfini/database typescript@5.4.0 --save-dev
npm install --workspace @blobinfini/api typescript@5.4.0 --save-dev
npm install --workspace @blobinfini/web typescript@5.4.0 --save-dev
git checkout -- package-lock.json apps/api/package.json apps/web/package.json packages/database/package.json packages/database/tsconfig.build.json
```
(Ou rebase sur la branche d’origine pour restaurer le lockfile.)

## Prochaines étapes suggérées
1. Démarrer l’infrastructure Postgres locale et rejouer `npx prisma migrate status`.
2. Diagnostiquer les erreurs `implicit any` :
   - Inspecter la résolution des types `@blobinfini/database`.
  – Ajouter au besoin des annotations (`satisfies`, alias `Awaited<…>`) ou ajuster la génération Prisma.
3. Relancer `npm run type-check`, `npm test`, puis `npm audit --omit=dev` pour valider la migration.
4. Mettre à jour la config Prisma (remplacer `package.json#prisma`).

## ⚠️ Problème résolu : Erreur STUDIO_EMBED_BUILD

**Date de résolution** : 2025-12-09

### Symptôme
Après la migration vers Prisma 6.19.0, Prisma Studio échouait au démarrage avec l'erreur :
```
Erreur du client Prisma : Impossible d'exécuter le script.
Appel invalide de STUDIO_EMBED_BUILD
Error: Aucun espace de travail par défaut trouvé
```

### Cause racine
Le package `@prisma/config` n'était pas installé. Ce package est **requis** depuis Prisma 6.19.0 pour supporter le fichier `prisma.config.ts`.

### Solution appliquée
```bash
npm install @prisma/config --workspace @blobinfini/database --save-dev
npm install node-gyp node-gyp-build -D --workspace @blobinfini/database
```

Également corrigé la version de `bcrypt` : `^6.0.0` → `^5.1.1` (version stable).

### Dépendances finales requises
Dans `packages/database/package.json` :
```json
{
  "dependencies": {
    "@prisma/client": "^6.19.0",
    "bcrypt": "^5.1.1"
  },
  "devDependencies": {
    "@prisma/config": "^6.19.0",
    "node-gyp": "^12.1.0",
    "node-gyp-build": "^4.8.4",
    "prisma": "^6.19.0"
  }
}
```

### Documentation complète
Voir [`docs/troubleshooting-prisma.md`](./troubleshooting-prisma.md) pour plus de détails et d'autres problèmes courants.
