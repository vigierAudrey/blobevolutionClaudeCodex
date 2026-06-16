# Déploiement automatique VPS

## Flux

Le flux de production est :

```text
push main
-> workflow GitHub Actions "CI"
-> workflow "Deploy VPS" uniquement si CI success sur main
-> SSH vers le VPS
-> git reset --hard origin/main dans VPS_DEPLOY_PATH
-> docker compose build api web
-> prisma migrate deploy
-> seed des comptes canaris de smoke
-> docker compose up -d
-> docker compose up -d --force-recreate caddy
-> scripts/smoke-test-vps.sh
```

Le workflow utilise `workflow_run` avec `workflows: ["CI"]`, `types: [completed]` et `branches: [main]`. Le job a aussi une condition explicite sur `github.event.workflow_run.conclusion == 'success'` et `head_branch == 'main'`.

Sources GitHub utilisées :
- `workflow_run` et filtre de branche : https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run
- Secrets GitHub Actions : https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets
- Deploy keys / SSH : https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys

## Secrets GitHub Actions

Créer les secrets dans `Settings -> Secrets and variables -> Actions` :

| Secret | Usage |
|---|---|
| `VPS_HOST` | Hostname DNS ou IP du VPS. |
| `VPS_USER` | Utilisateur Unix dédié au déploiement. Ne pas utiliser `root` sans justification écrite. |
| `VPS_PORT` | Port SSH. |
| `VPS_SSH_KEY` | Clé privée SSH dédiée au déploiement GitHub Actions -> VPS. |
| `VPS_DEPLOY_PATH` | Chemin du repo sur le VPS, par exemple `/home/deploy/blob-app`. |
| `API_BASE_URL` | Optionnel. Si absent, le smoke test dérive `https://$API_DOMAIN` depuis `.env.vps`. |

Ne jamais stocker dans GitHub Actions :
- `.env.vps`
- mots de passe applicatifs
- tokens applicatifs non nécessaires au SSH
- clés privées autres que la clé dédiée `VPS_SSH_KEY`

## Clé SSH dédiée

Créer une clé dédiée sur une machine sûre :

```bash
ssh-keygen -t ed25519 -C "github-actions-vps-deploy" -f ./github-actions-vps-deploy
```

Installer la clé publique sur le VPS pour l'utilisateur de déploiement :

```bash
install -d -m 700 /home/deploy/.ssh
cat github-actions-vps-deploy.pub >> /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys
```

Mettre la clé privée dans le secret GitHub `VPS_SSH_KEY`. Limiter l'utilisateur de déploiement au répertoire applicatif et aux commandes Docker nécessaires.

## SSH known_hosts

Le workflow utilise `ssh-keyscan` pour alimenter `known_hosts`, puis force `StrictHostKeyChecking=yes`. Procédure de contrôle avant activation :

```bash
ssh-keyscan -p "$VPS_PORT" "$VPS_HOST" > /tmp/vps_known_hosts
ssh-keygen -lf /tmp/vps_known_hosts
```

Comparer l'empreinte affichée avec l'empreinte obtenue depuis une session console fournisseur VPS ou une session SSH déjà fiable. En cas de différence, ne pas activer le déploiement.

## Cible Compose

Cible retenue après audit : `docker-compose.vps.yml`.

Justification :
- `docker-compose.vps.yml` est décrit comme l'environnement VPS Runtime BlobConnect.
- `docker-compose.pre-vps.yml` est un environnement local de qualification, interdit pour la production réelle.
- `docker-compose.blobsurf.yml` est legacy/historique et ne doit pas servir de cible au VPS actif.

Le workflow refuse si `docker-compose.vps.yml` ou `.env.vps` est absent sur le VPS.

## Commande distante

La commande exécutée sur le VPS est équivalente à :

```bash
cd "$VPS_DEPLOY_PATH"
PREV_SHA="$(git rev-parse HEAD)"

git fetch origin main
git checkout main
git reset --hard origin/main

docker compose -f docker-compose.vps.yml --env-file .env.vps build api web

docker compose -f docker-compose.vps.yml --env-file .env.vps run --rm api \
  sh -c "pnpm --filter @blobinfini/database exec prisma migrate deploy"

docker compose -f docker-compose.vps.yml --env-file .env.vps run --rm api \
  sh -c "ENV_FILE=/dev/null APP_ENV=pre-vps pnpm --filter @blobinfini/database exec tsx prisma/seed.pre-vps.ts"

docker compose -f docker-compose.vps.yml --env-file .env.vps up -d
docker compose -f docker-compose.vps.yml --env-file .env.vps up -d --force-recreate caddy

API_BASE_URL="${API_BASE_URL:-https://${API_DOMAIN}}" ./scripts/smoke-test-vps.sh
```

Le workflow refuse de démarrer si le worktree VPS contient des changements locaux non commités afin de ne pas les écraser silencieusement.

Le seed canari est ciblé sur les comptes `@pre-vps.blobinfini.local` référencés
par le smoke test. Il prépare les sessions RIDER, le match actif et les profils
nécessaires aux checks authentifiés, matching, messagerie et photo.

Le smoke de déploiement valide l'upload par URL présignée, le blocage XSS Caddy,
le CORS storage et l'absence de lecture anonyme non contrôlée. La policy publique
attendue est désormais `pros/*` uniquement — voir `docs/runbooks/vps-runtime.md`.
`users/*` doit rester privé en lecture anonyme. La policy ne doit pas être
réappliquée ou écrasée implicitement par le déploiement.

Le check d'email réel est optionnel par défaut (`SMOKE_EMAIL_REAL=0`) et son
skip ne bloque pas le déploiement. À l'inverse, le skip TLS strict reste
bloquant: un run VPS doit valider le certificat public Let's Encrypt sans mode
local `--resolve`.

## Rollback

En cas d'échec après la capture de `PREV_SHA`, le workflow exécute :

```bash
git reset --hard "$PREV_SHA"
docker compose -f docker-compose.vps.yml --env-file .env.vps build api web
docker compose -f docker-compose.vps.yml --env-file .env.vps up -d
exit 1
```

Ce rollback remet le code au commit précédent et reconstruit uniquement `api` et `web`. Il ne supprime aucun volume Docker et ne lance aucun prune.

## Logs et vérifications

Sur GitHub :

```text
Actions -> Deploy VPS -> dernier run
```

Sur le VPS :

```bash
cd "$VPS_DEPLOY_PATH"
docker compose -f docker-compose.vps.yml --env-file .env.vps ps
docker compose -f docker-compose.vps.yml --env-file .env.vps logs api --tail=100
docker compose -f docker-compose.vps.yml --env-file .env.vps logs web --tail=100
```

Smoke test manuel sur le VPS :

```bash
cd "$VPS_DEPLOY_PATH"
API_BASE_URL="https://api.blobsurf.com" ./scripts/smoke-test-vps.sh
```

Le script charge `.env.vps` et derive les endpoints publics depuis `API_DOMAIN`,
`APP_DOMAIN`, `STORAGE_DOMAIN` ou `S3_PUBLIC_URL_BASE`. En production, il refuse
les endpoints `*.local`, puis utilise l'origine navigateur autorisee
(`ALLOWED_ORIGINS`, typiquement `https://blobsurf.com`) pour les appels soumis a
la validation CORS.

## Désactivation temporaire

Options sûres :
- Désactiver le workflow `Deploy VPS` dans l'onglet GitHub Actions.
- Supprimer temporairement `VPS_SSH_KEY` des secrets GitHub Actions.
- Renommer temporairement `.env.vps` sur le VPS pour forcer un refus explicite.

Ne pas modifier le workflow pour contourner la condition CI verte.

## Interdits production

- Aucun secret dans le repo.
- Aucun `prisma db push --accept-data-loss`.
- Aucun `docker volume prune`.
- Aucun `docker system prune --volumes`.
- Aucun déploiement depuis une branche autre que `main`.
- Aucun déploiement si `CI` n'est pas verte.
