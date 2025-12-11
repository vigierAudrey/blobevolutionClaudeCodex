# Troubleshooting Prisma

Ce document recense les problèmes courants rencontrés avec Prisma dans ce projet et leurs solutions.

## 🚨 Erreur STUDIO_EMBED_BUILD / "Aucun espace de travail par défaut trouvé"

### Symptômes

Lors du lancement de Prisma Studio (`npm run db:studio`), l'erreur suivante apparaît dans le navigateur :

```
Erreur du client Prisma : Impossible d'exécuter le script.

Détails :
Appel invalide de `STUDIO_EMBED_BUILD`
u="u" && STUDIO_EMBED_BUILD?
_ke(): require(`${l.prismaClient}/runtime/${c}`);
F = e;
k = (0, TH.createHash)("sha256").update()
  dans /home/audrey/dev/blobevolutionClaudeCodex/node_modules/prisma/build/index.js:4825:10635

Error: Aucun espace de travail par défaut trouvé
    at n.workspaces.find(a => a.isDefault)
    at /home/audrey/dev/blobevolutionClaudeCodex/node_modules/prisma/build/index.js:4825:xxxx
```

Le frontend peut également ne plus fonctionner ou afficher des erreurs liées au client Prisma.

### Cause racine

**Le package `@prisma/config` est manquant.**

Depuis Prisma 6.19.0, le support du fichier `prisma.config.ts` nécessite le package `@prisma/config`. Si ce package n'est pas installé, Prisma Studio et le client Prisma échouent au démarrage.

Ce problème survient typiquement après :
- Un `npm install` qui n'a pas correctement installé toutes les dépendances
- Une migration depuis une version plus ancienne de Prisma
- Un nettoyage de `node_modules` suivi d'une réinstallation incomplète

### ✅ Solution

#### 1. Installer la dépendance manquante

```bash
npm install @prisma/config --workspace @blobinfini/database --save-dev
```

#### 2. (Si nécessaire) Corriger d'autres dépendances

Si vous rencontrez également des erreurs de compilation avec `bcrypt`, installez les outils de build :

```bash
npm install node-gyp node-gyp-build -D --workspace @blobinfini/database
```

Et vérifiez que la version de `bcrypt` est compatible :

```bash
# Dans packages/database/package.json
"bcrypt": "^5.1.1"  # Version stable recommandée
```

#### 3. Nettoyer et réinstaller (si les problèmes persistent)

```bash
# Nettoyage complet
rm -rf node_modules apps/*/node_modules packages/*/node_modules
rm -f package-lock.json

# Réinstallation
npm install
```

#### 4. Vérifier que tout fonctionne

```bash
# Vérifier la version de Prisma
npm run db:generate

# Tester Prisma Studio
npm run db:studio
# Devrait démarrer sur http://localhost:5555 ou http://localhost:5557
```

### Dépendances requises pour Prisma 6.19.0+

Assurez-vous que `packages/database/package.json` contient :

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

### Prévention

Pour éviter ce problème à l'avenir :

1. **Toujours vérifier les dépendances après une mise à jour de Prisma** :
   ```bash
   npm list @prisma/config
   ```

2. **Utiliser `npm ci` en CI/CD** au lieu de `npm install` pour garantir une installation reproductible

3. **Documenter les dépendances requises** dans le README ou la documentation de migration

4. **Tester Prisma Studio après chaque mise à jour** :
   ```bash
   npm run db:studio
   ```

### Versions testées

Cette solution a été validée avec :
- Prisma: `6.19.0`
- @prisma/client: `6.19.0`
- @prisma/config: `6.19.0`
- Studio: `0.511.0`
- Node.js: `v22.19.0`
- npm: `10.9.3`

### Références

- [Issue GitHub Prisma #27309](https://github.com/prisma/prisma/issues/27309)
- [Issue GitHub Prisma Studio #1195](https://github.com/prisma/studio/issues/1195)
- [Documentation Prisma Config](https://www.prisma.io/docs/orm/reference/prisma-cli-reference#prisma-configts)

---

## Autres problèmes courants

### Erreur "Cannot find module '@prisma/client'"

**Solution** : Régénérer le client Prisma
```bash
npm run db:generate
```

### Migrations en attente

**Solution** : Appliquer les migrations
```bash
npm run db:migrate:deploy
```

### Base de données inaccessible

**Solution** : Vérifier que PostgreSQL est démarré
```bash
docker compose up -d postgres
# Vérifier la connexion
docker compose ps postgres
```
