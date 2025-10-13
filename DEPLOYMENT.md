# DEPLOYMENT.md

## Prérequis
- Node.js 20+
- PostgreSQL + Redis accessibles
- Reverse proxy (Clever Cloud) configuré avec SSL
- Secrets générés via `./scripts/generate-secrets.sh`

## Variables d'environnement
| Variable | Description |
|----------|-------------|
| `NODE_ENV` | doit être `production` |
| `ALLOWED_ORIGINS` | origines front (CSV) |
| `SESSION_SECRET` | secret session (>=32 chars) |
| `JWT_SECRET` | secret JWT access |
| `JWT_REFRESH_SECRET` | secret JWT refresh |
| `TRUSTED_PROXY_IPS` | IP/CIDR proxies de confiance |
| `DATABASE_URL` | connexion PostgreSQL |
| `REDIS_URL` | cache Redis |
| `S3_*` | credentials S3/MinIO |
| `FIREBASE_*` | clés Firebase (optionnel) |

## Procédure
1. Exporter les variables d'environnement (fichier `.env.production`).
2. Installer les dépendances : `npm install`.
3. Générer les secrets si nécessaire : `./scripts/generate-secrets.sh`.
4. Lancer les builds/tests :
   ```bash
   npm run build --workspace @blobinfini/api
   npm test --workspace @blobinfini/api
   npm run build --workspace @blobinfini/web
   ```
5. Appliquer les migrations Prisma :
   ```bash
   npx prisma migrate deploy --schema packages/database/prisma/schema.prisma
   ```
6. Démarrer l'API en production :
   ```bash
   NODE_ENV=production node apps/api/dist/index.js
   ```
7. Démarrer le front Next.js :
   ```bash
   npm run start --workspace @blobinfini/web
   ```
8. Configurer le reverse proxy pour transférer les headers `X-Forwarded-*` (obligatoire pour `TRUSTED_PROXY_IPS`).

## Vérifications post-déploiement
- [ ] `curl -I https://api.blobinfini.com/health` → `200` + headers Helmet.
- [ ] `curl -I https://api.blobinfini.com/openapi.json` → `200`.
- [ ] Vérifier `Content-Security-Policy`, `Strict-Transport-Security`, `Referrer-Policy`.
- [ ] Vérifier les logs (aucun token exposé).
- [ ] Tester login/register depuis le front autorisé.
- [ ] Tester `/auth/refresh`, `/profile/me`, `/matching/search` avec payloads invalides → `400`.

## Notes
- En cas d'échec secrets/proxy, l'API refuse de démarrer.
- `TRUSTED_PROXY_IPS` doit refléter le réseau Clever Cloud.
- Les notifications push restent désactivées sans credentials Firebase ; prévoir fallback.
