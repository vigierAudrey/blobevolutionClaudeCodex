# Prisma Studio sur VPS — accès via tunnel SSH

## À quoi sert ce script

`scripts/prisma-studio-vps.sh` lance Prisma Studio sur le VPS en mode local uniquement.
Il est destiné aux opérations de maintenance sur la base de données de production
(inspection de données, vérification de migrations, débogage d'incidents).

## Pourquoi Prisma Studio ne doit jamais être exposé publiquement

Prisma Studio est une interface d'administration qui permet de **lire, modifier et supprimer**
n'importe quelle donnée de la base de données, sans authentification propre.
L'exposer sur un port public (même temporairement) représente un risque critique :
accès non autorisé aux données utilisateurs, modification ou suppression de données de production.

**Sur ce projet, Prisma Studio écoute uniquement sur `127.0.0.1`.**
L'accès se fait exclusivement via un tunnel SSH chiffré.

## Utilisation

### 1. Sur le VPS — lancer Prisma Studio

Depuis la racine du projet :

```bash
pnpm db:studio:vps
```

ou directement :

```bash
bash scripts/prisma-studio-vps.sh
```

Pour utiliser un port différent du port par défaut (5555) :

```bash
PRISMA_STUDIO_PORT=5556 bash scripts/prisma-studio-vps.sh
```

### 2. Depuis la machine locale — ouvrir le tunnel SSH

Dans un terminal local séparé, ouvrir le tunnel :

```bash
ssh -L 5555:127.0.0.1:5555 audrey@<IP_OU_HOST_DU_VPS>
```

Garder ce terminal ouvert pendant toute la session.

### 3. Ouvrir Prisma Studio dans le navigateur

```
http://localhost:5555
```

## Arrêter Prisma Studio

Sur le VPS, dans le terminal où le script tourne :

```
Ctrl+C
```

Le tunnel SSH peut ensuite être fermé en fermant le terminal local concerné.

## Vérifier que Prisma Studio écoute uniquement sur 127.0.0.1

Sur le VPS, pendant que Prisma Studio tourne :

```bash
ss -ltnp | grep 5555
```

Résultat **autorisé** :

```
LISTEN  0  128  127.0.0.1:5555  0.0.0.0:*
```

Résultat **interdit** (ne doit jamais apparaître) :

```
LISTEN  0  128  0.0.0.0:5555   0.0.0.0:*
```

Si le résultat interdit apparaît, arrêter immédiatement Prisma Studio (`Ctrl+C`).

## Interdits de sécurité

- Ne jamais lancer `prisma studio` avec `--hostname 0.0.0.0` ou sans `--hostname`.
- Ne jamais ouvrir le port 5555 dans Caddy, Docker Compose, le pare-feu ou GitHub Actions.
- Ne jamais partager la `DATABASE_URL` dans les logs, Slack, issues GitHub ou tout autre canal.
- Ne jamais utiliser `pnpm db:studio` (script sans `--hostname`) sur le VPS — il expose sur toutes les interfaces.
- Utiliser exclusivement `pnpm db:studio:vps` sur le VPS.
