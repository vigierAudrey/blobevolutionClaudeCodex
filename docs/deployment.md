# Deploiement - Document deprecie

> Statut: deprecie pour le chemin production actuel.
>
> Ce document conservait l'ancien cadrage production/staging base sur des providers
> manages et des notes Vercel/Clever Cloud. Il ne doit plus etre utilise comme
> runbook de deploiement.

## Source operationnelle actuelle

Pour deployer BlobConnect aujourd'hui, utiliser:

- `docs/ops/deploy-vps.md` pour le flux GitHub Actions -> VPS.
- `docs/runbooks/vps-runtime.md` pour l'exploitation runtime VPS.
- `docker-compose.vps.yml` pour la stack Docker Compose officielle.
- `docker/Caddyfile` pour le reverse proxy TLS Caddy.
- `.github/workflows/deploy-vps.yml` pour le workflow de deploiement automatique.

## Architecture actuelle

```text
push main
-> GitHub Actions "CI"
-> GitHub Actions "Deploy VPS" si CI verte
-> SSH vers le VPS Hetzner
-> docker compose -f docker-compose.vps.yml --env-file .env.vps build api web
-> prisma migrate deploy
-> docker compose -f docker-compose.vps.yml --env-file .env.vps up -d
-> scripts/smoke-test-vps.sh
```

Le runtime production utilise Caddy comme reverse proxy officiel. Les references
historiques a Vercel, Clever Cloud ou a un reverse proxy nginx ne representent plus
le chemin principal de deploiement.

## Pourquoi ce document n'est pas reecrit en runbook complet

Le choix maintenable est de conserver une seule procedure operationnelle detaillee:
`docs/ops/deploy-vps.md`.

Dupliquer ici les commandes de deploiement, les secrets GitHub Actions et la sequence
rollback augmenterait le risque de divergence. Ce fichier sert donc uniquement de
panneau de redirection pour les contributeurs qui ouvrent encore `docs/deployment.md`.

## Verification rapide

Avant une livraison production, verifier dans cet ordre:

1. `docs/ops/deploy-vps.md`
2. `.github/workflows/deploy-vps.yml`
3. `docker-compose.vps.yml`
4. `docs/runbooks/vps-runtime.md`

Toute modification de contrat API doit toujours mettre a jour `docs/openapi/openapi.yaml`
avant deploiement.
