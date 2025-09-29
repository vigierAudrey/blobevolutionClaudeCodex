# Storybook build bloqué sur TypeError `tap`

## 🎯 Objectif
- Débloquer la génération Storybook/visual tests pour que `npm run storybook:test` passe en local et en CI.

## 📍 Contexte
- Travail en cours dans `apps/web/.storybook/*`, script `scripts/run-storybook-tests.sh`, intégration CI `.github/workflows/ci.yml`.
- J’ai ajouté Storybook (v8.6.14) côté Next.js 14 ; le build échoue systématiquement avec `TypeError: Cannot read properties of undefined (reading 'tap')` émis par `@storybook/builder-webpack5` lors de la phase cache shutdown.
- Le script `npm run storybook:test` construit Storybook puis lance `test-storybook`; l’échec survient déjà sur `storybook build`.
- Extrait shell (mon terminal) :
  ```bash
  > @blobinfini/web@0.1.0 build-storybook
  > storybook build
  ...
  => Failed to build the preview
  SB_BUILDER-WEBPACK5_0002 (WebpackInvocationError): Module not found: TypeError: Cannot read properties of undefined (reading 'tap')
      at /node_modules/@storybook/builder-webpack5/dist/index.js:1:25029
      at /node_modules/next/dist/compiled/webpack/bundle5.js:28:312825
      at _done (...)
  ```
- J’ai tenté : désactiver cache webpack, forcer cache filesystem, pointer vers un `next.config.mjs` simplifié ; toujours le même crash.
- Pas de stories reposant sur Leaflet encore, juste `Button.stories.tsx`.

## ✅ Résultat attendu
- `npm run build-storybook --workspace @blobinfini/web` et `npm run storybook:test` doivent réussir.
- Solution documentée (config Storybook/webpack ou patch) pour éviter le `tap` undefined.
- Mettre à jour la doc si ajustement durable nécessaire.

## 🧪 Tests à exécuter
- `npm run build-storybook --workspace @blobinfini/web`
- `npm run storybook:test`
- Éventuellement `npm run lint --workspace @blobinfini/web` si la solution touche le code UI.

## ⚠️ Contraintes & garde-fous
- Éviter les changements Next.js hors périmètre Storybook (`apps/web/next.config.mjs`).
- Garder Storybook en v8 si possible (sinon proposer rollback argumenté).
- Ne pas supprimer les hooks RGPD/front ; limiter les changements aux fichiers Storybook/webpack nécessaires.

## ⏭️ Suivi
- Une fois corrigé : me pinger pour relancer la CI, mettre à jour `claude.md` si des règles Storybook supplémentaires apparaissent, et cocher la case Roadmap correspondante (Developer Experience › Storybook tests).
