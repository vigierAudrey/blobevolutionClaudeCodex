# 📚 Storybook Blobinfini

Ce guide résume la configuration Storybook actuelle, les décisions récentes (React-Leaflet, visual tests) et la gestion des avertissements de taille de bundles.

## ⚙️ Commandes utiles

- `npm run storybook --workspace @blobinfini/web` : lance Storybook en mode développement sur `http://localhost:6006`.
- `npm run build-storybook --workspace @blobinfini/web` : génère la version statique dans `apps/web/storybook-static`.
- `npm run storybook:test` : construit la version statique, la sert sur `127.0.0.1:6006` puis exécute `test-storybook --ci --failOnConsole`.

## 🗺️ Intégration React-Leaflet

- Le CSS Leaflet est chargé via `apps/web/.storybook/preview.ts` et un fallback supplémentaire dans `MapComponent.tsx` pour couvrir les imports dynamiques Next.js.
- Le package `react-leaflet` expose désormais son `package.json` via patch (`patches/react-leaflet+4.2.1.patch`) afin que Storybook résolve correctement l’ESM.
- Les stories `MapComponent.stories.tsx` démontrent l’usage des marqueurs, du rayon et du marqueur central. Elles encapsulent un rendu `render` personnalisé qui gère l’environnement Server/DOM.

## 🧱 Stories UI couvertes

Des stories “Default” + variantes ont été ajoutées pour les composants shadcn/ui : `Badge`, `Card`, `Dialog`, `Input`, `Label`, `Skeleton`, `Slider`, `Spinner`, `Textarea`, `Toast`, ainsi que la carte OSM (`MapComponent`). Chaque story fournit une description contextualisée pour Doc Blocks.

## 🧪 Tests visuels (test-storybook)

1. Le script `scripts/run-storybook-tests.sh` construit la version statique.
2. `http-server` sert le dossier `apps/web/storybook-static` sur `127.0.0.1:6006`.
3. `test-storybook` est lancé avec `--url http://127.0.0.1:6006` depuis le workspace web.

> Si les tests réclament une instance Storybook live malgré la build statique, redémarrer en local résout en général le cache. En CI, vérifier que le port 6006 n’est pas occupé avant d’exécuter le script.

## ⚠️ Avertissements de taille de bundles

### Pourquoi ?

- Les stories chargent de gros modules globaux (`firebase`, `leaflet`, `framer-motion`, etc.).
- Storybook Webpack 5 embarque encore tous les stories docs dans un entrypoint `main` unique.
- Les assets générés dépassent le seuil recommandé (342 KiB assets, 439 KiB entrypoint), d’où les `WARN` lors du build.

### Atténuations déjà en place

- `apps/web/.storybook/main.ts` force `splitChunks` agressif, avec séparation dédiée pour `leaflet` et `firebase`.
- `config.performance.maxAssetSize`/`maxEntrypointSize` ont été relevés pour refléter une cible réaliste.

### Optimisations possibles (choisir selon priorité)

1. **Migration builder Vite (`@storybook/builder-vite`)** : bundle plus fin et lazy evaluation native.
2. **Rendre certaines stories dynamiques** : p.ex. importer `MapComponent` via `lazy()` dans la story pour ne charger Leaflet qu’au clic.
3. **Découper `firebase` des stories** : mocker les hooks nécessitant Firebase dans la config Storybook au lieu d’importer la lib complète.
4. **Compression** : activer `webpack-bundle-analyzer` ponctuellement pour identifier les dépendances à retirer/optimiser.

Aucun warning n’est bloquant, mais surveiller la taille si de nouvelles stories ajoutent des dépendances lourdes.

## 📌 Maintenance continue

- Toute évolution de props UI → mettre à jour les stories correspondantes + accepter les diffs visuels.
- Ajouter systématiquement une story “Default” et au moins une variante par composant.
- Documenter les décisions dans cette page et dans `ROADMAP.md` (section Dev Experience) quand une action est livrée.

