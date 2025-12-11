# DEPLOYMENT.md

> Guide pratique pour livrer l’API + le front Blobinfini en environnement production/staging et valider les garde-fous sécurité (Phase 3 roadmap).

## 1. Prérequis
- Node.js 20+, npm 10+.
- PostgreSQL + Redis accessibles via réseau privé/SSL (`sslmode=require` obligatoires).
- Reverse proxy (Clever Cloud/Nginx) qui propage `X-Forwarded-*` et termine le TLS.
- Secrets générés avec `./scripts/generate-secrets.sh` (openssl ≥1.1).
- Accès à un compte admin pour déclencher le script `/security/health`.

## 2. Variables d’environnement

### Bloc critique (boot blockers)
| Variable | Description / attente |
|----------|----------------------|
| `NODE_ENV` | `production` (requis pour activer HSTS, cookies `secure`, purge jobs). |
| `ALLOWED_ORIGINS` | CSV des fronts autorisés (`https://app.blobinfini.com,https://admin.blobinfini.com`). Vide → crash en prod. |
| `TRUSTED_PROXY_IPS` | Liste IP/CIDR du reverse proxy Clever Cloud (sinon l’API refuse de démarrer). |
| `SESSION_SECRET` | ≥64 chars (généré via script). |
| `JWT_SECRET` | ≥64 chars (access token). |
| `JWT_REFRESH_SECRET` | ≥64 chars (refresh token). |
| `DATABASE_URL` | Doit contenir `sslmode=require` ou `sslmode=verify-full`. |
| `REDIS_URL` | URL Redis avec mot de passe fort (`rediss://` si fournisseur supporte TLS). |
| `AUTH_REQUIRE_VERIFIED` | `true` en production pour forcer email vérifié (riders & pros bloqués tant qu'ils n'ont pas validé). |

### Bloc opération (recommandé)
| Variable | Objectif |
|----------|----------|
| `GDPR_PURGE_INTERVAL_HOURS` / `GDPR_PURGE_RUN_ON_START` | Planification purge RGPD. |
| `CONV_PURGE_INTERVAL_HOURS` / `CONV_TRASH_RETENTION_DAYS` | Nettoyage conversations archivées. |
| `AUDIT_LOG_RETENTION_DAYS` | Conservation des audit logs (par défaut 365j). |
| `CSP_REPORT_ONLY` | Laisser à `false` en prod (mode blocage). |
| `S3_*` | Uploads (photos) via MinIO/S3. |
| `FIREBASE_*` | Notifications push (optionnel). |
| `SECURITY_HEALTH_URL` / `SECURITY_HEALTH_TOKEN` | Utilisés par le cron de supervision (cf. §6). |

> ⚠️ Les secrets sont validés au démarrage (`apps/api/src/index.ts`). Toute valeur manquante/faible arrête l’API immédiatement.
>
> ℹ️ **Redis obligatoire** : le 2FA admin repose désormais uniquement sur Redis (pas de fallback mémoire en production). Vérifier `REDIS_URL`, mot de passe et connectivité avant le déploiement.

## 3. Checklist pré-déploiement
1. Générer de nouveaux secrets (`./scripts/generate-secrets.sh`) et mettre à jour les variables correspondantes.
2. Compléter `ALLOWED_ORIGINS`, `TRUSTED_PROXY_IPS`, `DATABASE_URL?...sslmode=require`.
3. Mettre `AUTH_REQUIRE_VERIFIED=true` et `NODE_ENV=production` (bloque riders & pros tant que l'email n'est pas confirmé).
4. Vérifier `REDIS_URL` (mot de passe non trivial) + certificats si fournis.
5. Préparer un token admin jetable (voir SECURITY.md §Surveillance) pour tester `/security/health`.
6. Exporter toutes les variables dans un fichier `apps/api/.env.production` (jamais commité) puis sourcer avant build.
7. Configurer le monitoring : générer `SECURITY_HEALTH_TOKEN` (JWT admin ≤5 min de validité), définir `SECURITY_HEALTH_URL=https://api....`, renseigner `SECURITY_HEALTH_FAIL_WEBHOOK`/`SECURITY_HEALTH_OK_WEBHOOK` (Slack/Healthchecks) dans GitHub Secrets **et** dans Clever Cloud si un cron externe est utilisé.
8. Vérifier que `CSP_REPORT_ONLY=false` et que `SECURITY_HEALTH_TOKEN` sera renouvelé automatiquement (script cron ou secret roté manuellement chaque semaine).

## 4. Procédure de déploiement
```bash
# 1. Installer les dépendances
npm install

# 2. Construire et tester l’API
npm run build --workspace @blobinfini/api
npm test --workspace @blobinfini/api

# 3. Construire le package web
npm run build --workspace @blobinfini/web

# 4. Appliquer les migrations (DB déjà accessible SSL)
npx prisma migrate deploy --schema packages/database/prisma/schema.prisma

# 5. Démarrer les services
NODE_ENV=production node apps/api/dist/index.js
npm run start --workspace @blobinfini/web
```

**Reverse proxy** : activer `proxy_set_header X-Forwarded-For`/`Proto`; côté Clever Cloud, ajouter les IPs officielles dans `TRUSTED_PROXY_IPS`.

## 5. Vérifications post-déploiement

### API & sécurité
- [ ] `curl -I https://api.../health` → `200` + headers `Strict-Transport-Security`, `Content-Security-Policy`, `Referrer-Policy`.
- [ ] Script `/security/health` :
  ```bash
  curl -H "Authorization: Bearer ${SECURITY_HEALTH_TOKEN}" "${SECURITY_HEALTH_URL}" | jq
  ```
  Résultat attendu : `status:"SECURE"` et `issues:[]`. Toute entrée dans `issues` = blocage prod.
- [ ] `scripts/security-health-check.sh` avec les variables d’environnement réelles → sortie `"[security-health] OK – statut SECURE"` (garantit que le cron utilisera des secrets valides).
- [ ] CORS positif : `curl -H "Origin: https://front.prod" https://api.../health -I` → header `Access-Control-Allow-Origin` égal à l’origine.
- [ ] CORS négatif : `curl -H "Origin: https://evil.com" https://api.../health -I` → `403`.
- [ ] Rate limiting : 6 POST `/auth/login` rapides → `429` (profil `AUTH`).
- [ ] CSRF : POST `/profile/update` sans header `X-CSRF-Token` → `403`.
- [ ] JWT invalide : `curl -H "Authorization: Bearer xxx" https://api.../profile/me` → `401`.
- [ ] Login rider/pro non vérifié → `403` (`AUTH_REQUIRE_VERIFIED` + middleware `requireVerifiedEmail` sur toutes les routes rider/pro/admin). Après validation email, les routes booking/matching/push/contact/pro/admin doivent répondre `200`.

### Fonctionnel
- [ ] Flux login/register complet depuis le front autorisé (vérifier cookies CSRF).
- [ ] `/matching/search` + `/offers/search` avec payload invalide → `400` (Zod).
- [ ] Dashboard admin : `/admin/stats`, `/admin/audit` → 200 avec token admin valide.
- [ ] Frontend Next.js : `npm run start -w @blobinfini/web` → `0` warning SSR, pages matching & admin accessibles.

## 6. Monitoring `/security/health`

### Script CLI
- Utiliser `scripts/security-health-check.sh` (bash + curl + jq).
- Variables requises : `SECURITY_HEALTH_URL`, `SECURITY_HEALTH_TOKEN`. Optionnelles : `HC_FAIL_URL`, `HC_OK_URL`.
- Exemple :
  ```bash
  SECURITY_HEALTH_URL=https://api.blobinfini.com/security/health \
  SECURITY_HEALTH_TOKEN="..." \
  HC_FAIL_URL="https://hc-ping.com/fail" \
  HC_OK_URL="https://hc-ping.com/ok" \
  scripts/security-health-check.sh
  ```

### Cron GitHub Actions
- Workflow `.github/workflows/security-health-monitor.yml` exécute le script toutes les 30 minutes (et via `workflow_dispatch`).
- Secrets à configurer dans GitHub :
  - `SECURITY_HEALTH_URL`
  - `SECURITY_HEALTH_TOKEN`
  - `SECURITY_HEALTH_FAIL_WEBHOOK` (optionnel)
  - `SECURITY_HEALTH_OK_WEBHOOK` (optionnel)
- Pour déployer sur Clever Cloud, créer une tâche planifiée qui exécute la même commande en injectant les variables d’environnement.
- **Rôle du cron** : détecter rapidement toute dérive de configuration (origins non déclarés, secrets raccourcis, proxies non confiés). À chaque exécution, le workflow déclenche les webhooks adaptés (`HC_FAIL_URL`/`HC_OK_URL`) de façon à alerter l’équipe en <30 min sans intervention humaine.

## 7. Notes & dépannage
- L’API refuse de démarrer si l’un des secrets/`ALLOWED_ORIGINS`/`TRUSTED_PROXY_IPS` est absent en production. Corriger l’environnement plutôt que contourner.
- `DATABASE_URL` sans SSL → exception `DATABASE_URL must include "?sslmode=require"`.
- Pas de credentials Firebase ? Les endpoints push restent inactifs mais stables (logs `secureLogger` uniquement).
- Toute modification de DTO/API doit mettre à jour `docs/openapi/openapi.yaml` avant déploiement.
