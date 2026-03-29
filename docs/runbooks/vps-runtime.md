# Runbook VPS Runtime — BlobConnect

## Vue d'ensemble

Ce runbook couvre les opérations du lot **VPS Runtime Hardening**.

Différence fondamentale avec le pré-VPS :
- MinIO n'est **plus** exposé sur aucun port hôte
- Tout accès S3 (presigned PUT, lecture publique) passe par nginx TLS sur `storage.$DOMAIN`
- `MINIO_SERVER_URL=https://storage.$DOMAIN` est requis pour la validation HMAC des URLs présignées

## Architecture réseau VPS

```
Navigateur
    │
    │ HTTPS 443
    ▼
nginx (container)
    ├─ api.$DOMAIN       → api:4000
    ├─ app.$DOMAIN       → web:3000
    └─ storage.$DOMAIN   → minio:9000   ← CRITIQUE : seul point d'accès MinIO
                                           Aucun port 9000/9001 exposé sur l'hôte

Réseau interne Docker (172.21.0.0/16) :
  api → minio:9000        (S3_ENDPOINT=http://minio:9000)
  api → postgres:5432
  api → redis:6379
```

## Bootstrap

```bash
# 1. Copier et remplir l'env
cp .env.vps.example .env.vps
vim .env.vps  # Changer CHANGEME, STORAGE_DOMAIN, domaines

# 2. Bootstrap complet
./scripts/vps-bootstrap.sh

# 3. Avec /etc/hosts automatique (sudo)
./scripts/vps-bootstrap.sh --hosts

# 4. Qualification
./scripts/smoke-test-vps.sh
```

## Variables critiques

| Variable | Rôle | Contrainte VPS |
|---|---|---|
| `STORAGE_DOMAIN` | Domaine nginx pour MinIO | DOIT pointer sur ce VPS |
| `S3_PRESIGN_ENDPOINT` | Host dans les URLs présignées | JAMAIS localhost |
| `S3_PUBLIC_URL_BASE` | Base URL assets publics | JAMAIS localhost |
| `MINIO_SERVER_URL` | Host validé par MinIO pour HMAC | = `https://$STORAGE_DOMAIN` |

Cohérence requise (cassant si désalignée) :
```
S3_PRESIGN_ENDPOINT == https://$STORAGE_DOMAIN
S3_PUBLIC_URL_BASE  == https://$STORAGE_DOMAIN/$S3_BUCKET
MINIO_SERVER_URL    == https://$STORAGE_DOMAIN  (dans docker-compose.vps.yml)
```

## Bucket policy

Le bucket est configuré en **lecture anonyme (GET-only, sans listing)**.

- Uploads : via presigned PUT (authentifiés, 15 min d'expiry)
- Lectures : URL directe `https://storage.$DOMAIN/$BUCKET/key` (publique)
- Listing : interdit (la policy `download` de mc ne donne que `s3:GetObject`)

Re-appliquer la policy si nécessaire :
```bash
MINIO_INT_URL="http://${S3_ACCESS_KEY_ID}:${S3_SECRET_ACCESS_KEY}@minio:9000"

docker run --rm \
  --network blobconnect-vps_vps \
  -e "MC_HOST_minio=${MINIO_INT_URL}" \
  quay.io/minio/mc:RELEASE.2025-09-07T16-13-09Z \
  anonymous set download "minio/${S3_BUCKET}"
```

Vérifier la policy :
```bash
docker run --rm \
  --network blobconnect-vps_vps \
  -e "MC_HOST_minio=${MINIO_INT_URL}" \
  quay.io/minio/mc:RELEASE.2025-09-07T16-13-09Z \
  anonymous get "minio/${S3_BUCKET}"
# Attendu : Access permission for `minio/blobinfini-vps` is `download`
```

## Accès console MinIO (admin)

MinIO console (port 9001) n'est **pas** exposé sur l'hôte.

Accès via tunnel SSH :
```bash
ssh -L 9001:127.0.0.1:9001 user@vps-ip
# Puis naviguer vers http://localhost:9001
```

Credentials : `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` dans `.env.vps`.

## Diagnostic S3

### Presigned URL ne fonctionne pas (403/SignatureDoesNotMatch)

Cause probable : `MINIO_SERVER_URL` ne correspond pas à `S3_PRESIGN_ENDPOINT`.

Vérifier :
```bash
# Voir les logs MinIO
docker compose -f docker-compose.vps.yml logs minio --tail=50

# Vérifier la variable dans le container MinIO
docker compose -f docker-compose.vps.yml exec minio env | grep MINIO_SERVER_URL
```

Correction : s'assurer que dans `docker-compose.vps.yml` :
```yaml
MINIO_SERVER_URL: "https://${STORAGE_DOMAIN:-storage.blobinfini.local}"
```
correspond exactement à `S3_PRESIGN_ENDPOINT` dans `.env.vps`.

### Bucket inaccessible en lecture publique (403)

```bash
# Vérifier la policy
docker run --rm --network blobconnect-vps_vps \
  -e "MC_HOST_minio=http://${S3_ACCESS_KEY_ID}:${S3_SECRET_ACCESS_KEY}@minio:9000" \
  quay.io/minio/mc:RELEASE.2025-09-07T16-13-09Z \
  anonymous get "minio/${S3_BUCKET}"

# Réappliquer si absent
docker run --rm --network blobconnect-vps_vps \
  -e "MC_HOST_minio=http://${S3_ACCESS_KEY_ID}:${S3_SECRET_ACCESS_KEY}@minio:9000" \
  quay.io/minio/mc:RELEASE.2025-09-07T16-13-09Z \
  anonymous set download "minio/${S3_BUCKET}"
```

### nginx n'atteint pas MinIO

```bash
# Vérifier le container minio est healthy
docker compose -f docker-compose.vps.yml ps minio

# Tester la connectivité depuis nginx
docker compose -f docker-compose.vps.yml exec nginx \
  wget -qO- http://minio:9000/minio/health/live && echo "OK"

# Logs nginx
docker compose -f docker-compose.vps.yml logs nginx --tail=50
```

## Arrêt et maintenance

```bash
# Arrêt propre
docker compose -f docker-compose.vps.yml down

# Arrêt + reset volumes (DESTRUCTIF — perd les données)
./scripts/vps-bootstrap.sh --reset

# Redémarrage sans rebuild
docker compose -f docker-compose.vps.yml --env-file .env.vps up -d

# Rebuild image API uniquement
docker compose -f docker-compose.vps.yml --env-file .env.vps build api
docker compose -f docker-compose.vps.yml --env-file .env.vps up -d api
```

## Passage en production (domaines réels)

1. **DNS** : pointer `api.blobinfini.fr`, `app.blobinfini.fr`, `storage.blobinfini.fr` vers l'IP du VPS
2. **Certs** : remplacer mkcert par Let's Encrypt (certbot ou acme.sh)
3. **nginx.vps.conf** : remplacer `*.blobinfini.local` → `*.blobinfini.fr` (ou votre domaine)
4. **VPS_CERTS_DIR** : pointer vers les certs Let's Encrypt (`/etc/letsencrypt/live/...`)
5. **STORAGE_DOMAIN** : mettre `storage.blobinfini.fr` dans `.env.vps`
6. **SMTP** : remplacer Mailpit par un SMTP réel (Brevo, Postmark, SES...)
7. **AUTH_REQUIRE_2FA** : passer à `true` pour la production
8. Relancer `check-vps-env.sh` — doit passer sans erreur
9. Relancer `smoke-test-vps.sh` — doit retourner GO VPS ✓

## Threat model spécifique VPS

| Vecteur | Mitigation |
|---|---|
| Fuite URL interne MinIO | S3_PRESIGN_ENDPOINT = URL nginx publique. check-vps-env.sh rejette localhost. |
| Exposition directe MinIO | Aucun port 9000/9001 dans docker-compose.vps.yml |
| Bucket trop ouvert | Policy `download` uniquement (GET-object, pas ListBucket ni PutObject) |
| Presigned URL mal configurée | MINIO_SERVER_URL = S3_PRESIGN_ENDPOINT (validation HMAC côté MinIO) |
| Confusion pré-VPS / VPS | APP_ENV=vps, project name distinct, volumes distincts, subnet distinct |
| Credentials MinIO par défaut | check-vps-env.sh rejette minioadmin et pvps-access-key |
| Accès console MinIO depuis internet | Port 9001 non exposé — tunnel SSH requis |
| TLS mal câblé (cert storage manquant) | check-vps-env.sh vérifie les 3 certs (api, app, storage) |
