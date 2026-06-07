# Runbook VPS Runtime - BlobConnect

> Source operationnelle VPS. Ce runbook decrit la stack reelle actuelle:
> Hetzner VPS, Docker Compose, Caddy, PostgreSQL/PostGIS, Redis, MinIO, API Express
> et frontend Next.js.

## Sources de verite

- `docker-compose.vps.yml` : services runtime VPS et reseau Docker.
- `docker/Caddyfile` : reverse proxy TLS, routage API/web/storage et CORS storage.
- `.github/workflows/deploy-vps.yml` : deploiement automatique apres CI verte.
- `.github/workflows/ci.yml` : garde-fous CI, dont l'interdiction de nginx dans `docker-compose.vps.yml`.
- `scripts/guard-no-nginx-vps.sh` : politique explicite "Caddy est le reverse proxy officiel".
- `docs/ops/deploy-vps.md` : procedure de deploiement automatique GitHub Actions -> VPS.

## Vue d'ensemble

Difference fondamentale avec le pre-VPS local:

- MinIO n'est expose sur aucun port hote en VPS.
- Tout acces S3 public ou presigne passe par Caddy TLS sur `https://$STORAGE_DOMAIN`.
- `MINIO_SERVER_URL=https://$STORAGE_DOMAIN` est requis pour que MinIO valide les URLs presignees avec le bon host public.
- Caddy gere automatiquement les certificats Let's Encrypt via ACME HTTP-01.

`nginx` n'est plus le reverse proxy officiel du VPS. Il reste limite a l'environnement
local `docker-compose.pre-vps.yml` avec mkcert.

## Architecture reseau VPS

```text
Navigateur
    |
    | HTTPS 443 / HTTP 80 pour ACME
    v
Caddy (container)
    |- $API_DOMAIN     -> api:4000
    |- $APP_DOMAIN     -> web:3000
    `- $STORAGE_DOMAIN -> minio:9000
                         seul point d'acces public MinIO

Reseau Docker interne `blobconnect-vps_vps` (172.21.0.0/16):
  api -> minio:9000        (S3_ENDPOINT=http://minio:9000)
  api -> postgres:5432
  api -> redis:6379
  web -> api via URL publique configuree
```

## Bootstrap

```bash
# 1. Copier et remplir l'env sur le VPS
cp .env.vps.example .env.vps
vim .env.vps

# 2. Verifier l'environnement
bash scripts/check-vps-env.sh .env.vps

# 3. Bootstrap complet
./scripts/vps-bootstrap.sh

# 4. Qualification
./scripts/smoke-test-vps.sh
```

Pre-requis DNS et firewall:

- `APP_DOMAIN`, `API_DOMAIN` et `STORAGE_DOMAIN` pointent vers l'IP du VPS Hetzner.
- Les ports 80 et 443 sont ouverts.
- `CADDY_ACME_EMAIL` est defini dans `.env.vps`.

## Variables critiques

| Variable | Role | Contrainte VPS |
|---|---|---|
| `APP_DOMAIN` | Domaine public du frontend | Pointe vers le VPS |
| `API_DOMAIN` | Domaine public de l'API | Pointe vers le VPS |
| `STORAGE_DOMAIN` | Domaine public MinIO via Caddy | Pointe vers le VPS |
| `CADDY_ACME_EMAIL` | Email ACME Let's Encrypt | Obligatoire |
| `S3_ENDPOINT` | API -> MinIO interne | `http://minio:9000` |
| `S3_PRESIGN_ENDPOINT` | URL presignee vue par le navigateur | `https://$STORAGE_DOMAIN` |
| `S3_PUBLIC_URL_BASE` | Base publique des assets | `https://$STORAGE_DOMAIN/$S3_BUCKET` |
| `MINIO_SERVER_URL` | Host public valide par MinIO | `https://$STORAGE_DOMAIN` |
| `TRUSTED_PROXY_IPS` | Proxy Docker autorise | `172.21.0.0/16` pour `docker-compose.vps.yml` |

Coherence requise:

```text
S3_PRESIGN_ENDPOINT == https://$STORAGE_DOMAIN
S3_PUBLIC_URL_BASE  == https://$STORAGE_DOMAIN/$S3_BUCKET
MINIO_SERVER_URL    == https://$STORAGE_DOMAIN
```

## Lecture publique MinIO

> **Cible securite actuelle (2026-06-07)**
> Prefixe public autorise : `pros/*` uniquement — `s3:GetObject` sans
> `s3:ListBucket`.
> Les objets `users/*` doivent rester interdits en lecture anonyme.
> Si un environnement historique a ouvert `users/*`, traiter cela comme une
> remediation RGPD et reposer une policy `pros/*` seulement apres validation
> humaine.
>
> Rappel securite : a terme, preferer un prefixe plus strict pour reduire la
> surface, par exemple `public/pros/photos/*` au lieu de `pros/*`.

Les URLs renvoyees par `POST /pro/photo/finalize` sont des URLs publiques
stables construites depuis `S3_PUBLIC_URL_BASE`. Elles ne doivent pas contenir de
signature, de token ou de secret.

La policy MinIO autorise la lecture anonyme uniquement sur les prefixes de
medias publics. La cible actuelle est `pros/*` public et `users/*` prive. La
policy n'accorde pas `s3:ListBucket` et ne rend pas tout le bucket public.

Audit sans modification :

```bash
ENV_FILE=.env.vps \
COMPOSE_FILE=docker-compose.blobsurf.yml \
scripts/minio-public-prefix-policy.sh --dry-run --prefix 'pros/*'
```

Application idempotente (prefixe pros/* seulement) :

```bash
ENV_FILE=.env.vps \
COMPOSE_FILE=docker-compose.blobsurf.yml \
scripts/minio-public-prefix-policy.sh --prefix 'pros/*'
```

Rollback lecture publique :

```bash
ENV_FILE=.env.vps \
COMPOSE_FILE=docker-compose.blobsurf.yml \
scripts/minio-public-prefix-policy.sh --clear
```

Verification attendue apres application ou remediation :

```bash
curl -I "https://$STORAGE_DOMAIN/$S3_BUCKET/users/<uuid>/<uuid>.png"
# HTTP/2 403 — media rider non accessible anonymement

curl -I "https://$STORAGE_DOMAIN/$S3_BUCKET/pros/<uuid>/<uuid>.png"
# HTTP/2 200 — photo pro accessible

curl -I "https://$STORAGE_DOMAIN/$S3_BUCKET/pros/<uuid>/<uuid>.jpeg"
# HTTP/2 200 — photo pro jpeg accessible

curl -I "https://$STORAGE_DOMAIN/$S3_BUCKET/"
# HTTP/2 403 — racine bucket inaccessible

curl -I "https://$STORAGE_DOMAIN/$S3_BUCKET/hostile-audit/test.txt"
# HTTP/2 403 — prefixe non autorise inaccessible
```

## Deploiement automatique

Le chemin de production est documente dans `docs/ops/deploy-vps.md`:

```text
push main
-> workflow GitHub Actions "CI"
-> workflow "Deploy VPS" uniquement si CI success sur main
-> SSH vers le VPS
-> git reset --hard origin/main dans VPS_DEPLOY_PATH
-> docker compose build api web
-> prisma migrate deploy
-> docker compose up -d
-> scripts/smoke-test-vps.sh
```

Le workflow refuse de demarrer si `docker-compose.vps.yml` ou `.env.vps` est absent
sur le VPS.

## Diagnostics runtime

### Etat des services

```bash
docker compose -f docker-compose.vps.yml --env-file .env.vps ps
```

### Logs principaux

```bash
docker compose -f docker-compose.vps.yml --env-file .env.vps logs caddy --tail=100
docker compose -f docker-compose.vps.yml --env-file .env.vps logs api --tail=100
docker compose -f docker-compose.vps.yml --env-file .env.vps logs web --tail=100
docker compose -f docker-compose.vps.yml --env-file .env.vps logs minio --tail=100
```

### Verifier la connectivite Caddy -> MinIO

```bash
docker compose -f docker-compose.vps.yml --env-file .env.vps exec caddy \
  wget -qO- http://minio:9000/minio/health/live && echo "OK"
```

### Verifier la configuration MinIO

```bash
docker compose -f docker-compose.vps.yml --env-file .env.vps exec minio \
  env | grep MINIO_SERVER_URL
```

La valeur attendue est `https://$STORAGE_DOMAIN`.

### Smoke test manuel

```bash
API_BASE_URL="https://${API_DOMAIN}" ./scripts/smoke-test-vps.sh
```

### Diagnostic trust proxy (symptome : CSRF_NO_SECRET ou rate-limit sur IP Docker)

Symptomes caracteristiques d'une misconfiguration `TRUSTED_PROXY_IPS` :

- `POST /auth/register` retourne `403 CSRF_NO_SECRET` alors que `GET /csrf-token` repond
- Les cles Redis de rate-limit contiennent `r:172.21.0.7` (IP Docker de Caddy) au lieu de l'IP client
- `GET /csrf-token` ne retourne pas `Set-Cookie: ... Secure; HttpOnly` dans les logs Caddy

Cause : `TRUSTED_PROXY_IPS` pointe vers un mauvais subnet. Express ne fait pas confiance a Caddy,
`req.secure=false`, le cookie de session n'est pas pose correctement.

Verifier la valeur active sur le VPS :

```bash
# Afficher TRUSTED_PROXY_IPS actif dans le conteneur api
docker compose -f docker-compose.vps.yml --env-file .env.vps exec api \
  printenv TRUSTED_PROXY_IPS
# Valeur attendue : 172.21.0.0/16  (subnet du reseau Docker vps)

# Verifier le subnet Docker effectif
docker network inspect blobconnect-vps_vps | grep -A2 '"Subnet"'
# Valeur attendue : 172.21.0.0/16
```

Corriger si necessaire dans `.env.vps` puis recreer le conteneur :

```bash
# Modifier .env.vps : TRUSTED_PROXY_IPS=172.21.0.0/16
docker compose -f docker-compose.vps.yml --env-file .env.vps up -d api
```

Rappel des subnets par stack :

| Stack                        | Subnet Docker    | TRUSTED_PROXY_IPS |
|------------------------------|------------------|-------------------|
| `docker-compose.vps.yml`     | 172.21.0.0/16    | 172.21.0.0/16     |
| `docker-compose.blobsurf.yml`| 172.22.0.0/16    | 172.22.0.0/16     |

Ne jamais croiser ces valeurs entre les deux stacks.

## Bucket policy

Le bucket est configure en lecture anonyme GET-only, sans listing.

- Uploads : via presigned PUT authentifie, avec expiration courte.
- Lectures : URL directe `https://$STORAGE_DOMAIN/$S3_BUCKET/key`.
- Listing : interdit.

Verifier la policy:

```bash
MINIO_INT_URL="http://${S3_ACCESS_KEY_ID}:${S3_SECRET_ACCESS_KEY}@minio:9000"

docker run --rm \
  --network blobconnect-vps_vps \
  -e "MC_HOST_minio=${MINIO_INT_URL}" \
  quay.io/minio/mc:RELEASE.2025-09-07T16-13-09Z \
  anonymous get "minio/${S3_BUCKET}"
```

Re-appliquer la policy si necessaire:

```bash
docker run --rm \
  --network blobconnect-vps_vps \
  -e "MC_HOST_minio=${MINIO_INT_URL}" \
  quay.io/minio/mc:RELEASE.2025-09-07T16-13-09Z \
  anonymous set download "minio/${S3_BUCKET}"
```

## Acces console MinIO

La console MinIO n'est pas exposee publiquement.

Acces via tunnel SSH:

```bash
ssh -L 9001:127.0.0.1:9001 user@vps-ip
# Puis ouvrir http://localhost:9001
```

Identifiants: `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` dans `.env.vps`.

## Maintenance

```bash
# Arret propre
docker compose -f docker-compose.vps.yml --env-file .env.vps down

# Redemarrage sans rebuild
docker compose -f docker-compose.vps.yml --env-file .env.vps up -d

# Rebuild API uniquement
docker compose -f docker-compose.vps.yml --env-file .env.vps build api
docker compose -f docker-compose.vps.yml --env-file .env.vps up -d api

# Recharger Caddy apres modification du Caddyfile
docker compose -f docker-compose.vps.yml --env-file .env.vps exec caddy \
  caddy reload --config /etc/caddy/Caddyfile
```

Reset destructif:

```bash
./scripts/vps-bootstrap.sh --reset
```

Cette commande supprime les volumes VPS. Ne pas l'utiliser sur une production contenant
des donnees sans procedure de sauvegarde/restauration validee.

## Threat model specifique VPS

| Vecteur | Mitigation |
|---|---|
| Fuite URL interne MinIO | Les URLs navigateur utilisent `S3_PRESIGN_ENDPOINT=https://$STORAGE_DOMAIN`. |
| Exposition directe MinIO | Aucun port 9000/9001 n'est expose dans `docker-compose.vps.yml`. |
| Bucket trop ouvert | Policy `download` uniquement: GET object, pas ListBucket ni PutObject. |
| Presigned URL mal configuree | `MINIO_SERVER_URL` doit correspondre au host public Caddy. |
| Confusion pre-VPS / VPS | `APP_ENV=vps`, project name et volumes dedies. |
| TRUSTED_PROXY_IPS mauvais subnet | CSRF_NO_SECRET, rate-limit sur IP Docker. Corriger avec subnet du reseau VPS (`172.21.0.0/16`). |
| IP spoofing via X-Forwarded-For | Caddy set `header_up X-Forwarded-For {remote_host}` (IP TCP relle, non alterable). |
| Fallback silencieux vers Mailpit | `docker-compose.vps.yml` n'embarque aucun Mailpit; Brevo SMTP authentifie est requis. |
| Credentials MinIO par defaut | `check-vps-env.sh` rejette les credentials faibles ou de demo. |
| Acces console MinIO internet | Port 9001 non expose; tunnel SSH requis. |
| TLS mal cable | Caddy emet et renouvelle les certificats via Let's Encrypt; verifier `logs caddy`. |

## WebSocket - contrainte single-instance

La configuration actuelle est qualifiee pour une seule replique API (`REPLICAS=1`).
Socket.IO maintient les rooms en memoire par processus.

Ne pas documenter ni activer de scale horizontal sans prerequisites explicites:

- adapter Redis Socket.IO active et teste;
- strategie de session affinity compatible avec les transports Socket.IO;
- smoke tests de revocation et de broadcast relances apres scale-up.

Tant que ces prerequisites ne sont pas livres, le deploiement VPS officiel reste
single-instance.
